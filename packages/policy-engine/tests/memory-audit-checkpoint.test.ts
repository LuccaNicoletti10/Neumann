/**
 * policy-engine — tests/memory-audit-checkpoint.test.ts
 *
 * The in-memory audit repository is a store of the memory unit of work
 * (PROMPT 09 item 1). A rollback must remove the trail of the mutation that
 * never happened, and must not truncate entries committed before the snapshot.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryAuditRepository } from '../src/core/memory-audit-repository.js';

async function genesis(repo: ReturnType<typeof createMemoryAuditRepository>) {
  return repo.appendChained({
    id: 'a-0',
    messageType: 'GENESIS',
    eventData: 'start',
    metadata: {},
    salt: 's0',
    at: 't0',
    principal: 'system',
  });
}

function entry(id: string) {
  return {
    id,
    messageType: 'EVENT' as const,
    eventData: `event-${id}`,
    metadata: {},
    salt: `salt-${id}`,
    at: 't1',
    principal: 'alice',
  };
}

describe('memory audit repository — checkpoint', () => {
  it('restore drops entries appended after capture and keeps the earlier chain', async () => {
    const repo = createMemoryAuditRepository();
    await genesis(repo);
    const kept = await repo.appendChained(entry('a-1'));

    const snapshot = repo.capture();
    await repo.appendChained(entry('a-2'));
    expect(await repo.list()).toHaveLength(3);

    repo.restore(snapshot);
    const after = await repo.list();
    expect(after).toHaveLength(2);
    expect(after.at(-1)?.id).toBe('a-1');
    expect(await repo.getById('a-2')).toBeUndefined();
    expect((await repo.head())?.summaryHash).toBe(kept.summaryHash);
  });

  it('the chain continues from the restored head, not from the abandoned entry', async () => {
    const repo = createMemoryAuditRepository();
    await genesis(repo);
    const head = await repo.appendChained(entry('b-1'));

    const snapshot = repo.capture();
    const abandoned = await repo.appendChained(entry('b-2'));
    repo.restore(snapshot);

    const next = await repo.appendChained(entry('b-3'));
    expect(next.previousSummaryHash).toBe(head.summaryHash);
    expect(next.previousSummaryHash).not.toBe(abandoned.summaryHash);
  });

  it('capture is a copy: mutating the repository does not rewrite the snapshot', async () => {
    const repo = createMemoryAuditRepository();
    await genesis(repo);
    const snapshot = repo.capture() as readonly unknown[];
    await repo.appendChained(entry('c-1'));
    expect(snapshot).toHaveLength(1);
  });
});
