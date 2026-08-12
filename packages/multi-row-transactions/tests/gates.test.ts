/**
 * multi-row-transactions — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createMultiRowTransactionSystem } from '../src/core/system.js';

function sys() {
  return createMultiRowTransactionSystem({
    clock: createDeterministicClock('2024-01-01T14:37:00.000Z'),
    nextId: createIdGenerator(),
    tables: ['accounts'],
  });
}

describe('Passo 10 gates', () => {
  it('snapshot(at) é determinístico', () => {
    const s = sys();
    const t = s.startTransaction();
    s.set(t, 'accounts', 'Alice', 'BankBalance', 12);
    s.set(t, 'accounts', 'Bob', 'BankBalance', 13);
    expect(s.commit(t)).toBe(true);

    const a = s.snapshot({ dataset: 'accounts', at: '2024-01-01T14:37:22.000Z' });
    const b = s.snapshot({ dataset: 'accounts', at: '2024-01-01T14:37:22.000Z' });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.rows).toEqual(b.rows);
  });

  it('commit multi-linha é atômico (ambos saldos ou nenhum)', () => {
    const s = sys();
    const init = s.startTransaction();
    s.set(init, 'accounts', 'Alice', 'BankBalance', 12);
    s.set(init, 'accounts', 'Bob', 'BankBalance', 13);
    s.commit(init);

    const tx = s.startTransaction();
    s.set(tx, 'accounts', 'Alice', 'BankBalance', 22);
    s.set(tx, 'accounts', 'Bob', 'BankBalance', 3);
    expect(s.commit(tx)).toBe(true);

    const snap = s.snapshot({ dataset: 'accounts', at: tx.commitTs! });
    expect(snap.rows['Alice']?.['BankBalance']).toBe(22);
    expect(snap.rows['Bob']?.['BankBalance']).toBe(3);
  });

  it('crash entre write e commit não corrompe (writes órfãos removidos)', () => {
    const s = sys();
    const init = s.startTransaction();
    s.set(init, 'accounts', 'Alice', 'BankBalance', 12);
    s.commit(init);

    const crash = s.startTransaction();
    s.set(crash, 'accounts', 'Alice', 'BankBalance', 999);
    s.crashBeforeCommitFinalize(crash);
    expect(crash.status).toBe('FAILED');

    const r = s.startTransaction();
    expect(s.get(r, 'accounts', 'Alice', 'BankBalance')).toBe(12);
    s.abort(r);
  });

  it('leitura não vê writes buffered de outra tx (isolamento)', () => {
    const s = sys();
    const init = s.startTransaction();
    s.set(init, 'accounts', 'Alice', 'BankBalance', 12);
    s.commit(init);

    const writer = s.startTransaction();
    s.set(writer, 'accounts', 'Alice', 'BankBalance', 50);

    const reader = s.startTransaction();
    expect(s.get(reader, 'accounts', 'Alice', 'BankBalance')).toBe(12);
    s.abort(reader);
    s.abort(writer);
  });

  it('write-write conflict: segunda commit falha', () => {
    const s = sys();
    const a = s.startTransaction();
    const b = s.startTransaction();
    s.set(a, 'accounts', 'Dave', 'BankBalance', 100);
    s.set(b, 'accounts', 'Dave', 'BankBalance', 200);
    expect(s.commit(a)).toBe(true);
    expect(s.commit(b)).toBe(false);
  });

  it('replay bate com snapshot no head', () => {
    const s = sys();
    const t = s.startTransaction();
    s.set(t, 'accounts', 'Alice', 'BankBalance', 1);
    s.commit(t);
    const t2 = s.startTransaction();
    s.set(t2, 'accounts', 'Alice', 'BankBalance', 2);
    s.commit(t2);

    const snap = s.snapshot({ dataset: 'accounts', at: t2.commitTs! });
    const rep = s.replay('accounts', t2.commitTs);
    expect(rep.contentHash).toBe(snap.contentHash);
    expect(rep.transactionsReplayed).toBe(2);
  });

  it('diffVersions detecta células mudadas', () => {
    const s = sys();
    const t1 = s.startTransaction();
    s.set(t1, 'accounts', 'Alice', 'BankBalance', 1);
    s.commit(t1);
    const t2 = s.startTransaction();
    s.set(t2, 'accounts', 'Alice', 'BankBalance', 2);
    s.commit(t2);
    const d = s.diffVersions('accounts', t1.commitTs!, t2.commitTs!);
    expect(d.changedCells).toContainEqual({ row: 'Alice', column: 'BankBalance' });
  });
});
