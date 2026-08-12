/**
 * transformation-runner — tests/gates.test.ts
 * Gate Passo 11: mesmo input → mesmo content-hash; DSL + incremental.
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createTransformationRunner } from '../src/core/runner.js';
import { analyzeIncremental } from '../src/core/incremental.js';
import { compileProgramSql } from '../src/core/sql.js';
import { hasCycle, buildLinearDag } from '../src/core/dag.js';
import { runDemo } from '../src/cli.js';

function runner() {
  return createTransformationRunner({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 11 gates', () => {
  it('mesmo input → mesmo content-hash (duas runs)', () => {
    const r = runner();
    r.registerTable({
      name: 't',
      columns: ['id', 'status'],
      rows: [
        { id: 1, status: 'active' },
        { id: 2, status: 'closed' },
      ],
    });
    const def = r.dsl.newTable('out');
    r.dsl.startWith(def, 't');
    r.dsl.transformation(def, 'filter', { column: 'status', values: ['active'] });
    const prog = r.build(def);
    const gate = r.assertDeterministic(prog);
    expect(gate.ok).toBe(true);
    expect(gate.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('SQL versionado é estável e sem NOW()', () => {
    const steps = [
      {
        kind: 'filter' as const,
        params: { column: 'status', values: ['active'] },
      },
      {
        kind: 'rename' as const,
        params: { from: 'status', to: 'state' },
      },
    ];
    const sql1 = compileProgramSql('orders', steps);
    const sql2 = compileProgramSql('orders', steps);
    expect(sql1).toBe(sql2);
    expect(sql1).not.toMatch(/\bNOW\s*\(/i);
    expect(sql1).toContain('orders');
  });

  it('sort marca IMPOSSIBLE; filter marca CONCATENATE', () => {
    expect(
      analyzeIncremental([{ kind: 'filter', params: { column: 'a', values: [1] } }])
        .computability,
    ).toBe('CONCATENATE');
    expect(
      analyzeIncremental([{ kind: 'sort', params: { column: 'a' } }]).computability,
    ).toBe('IMPOSSIBLE');
  });

  it('incremental CONCATENATE bate com FULL após append', () => {
    const r = runner();
    r.registerTable({
      name: 'orders',
      columns: ['id', 'status'],
      rows: [
        { id: 1, status: 'active' },
        { id: 2, status: 'closed' },
      ],
    });
    const def = r.dsl.newTable('active');
    r.dsl.startWith(def, 'orders');
    r.dsl.transformation(def, 'filter', {
      column: 'status',
      values: ['active'],
    });
    const prog = r.build(def);
    expect(prog.computability).toBe('CONCATENATE');

    const inc = r.performIncrementalComputation(prog, [
      { id: 3, status: 'active' },
      { id: 4, status: 'closed' },
    ]);
    expect(inc.mode).toBe('INCREMENTAL');
    expect(inc.rowCount).toBe(2); // id 1 + id 3

    const full = r.run(prog);
    expect(full.contentHash).toBe(inc.contentHash);
    expect(full.rowCount).toBe(2);
  });

  it('DAG linear sem ciclo', () => {
    const dag = buildLinearDag('p1', 'src', ['filter', 'join']);
    expect(hasCycle(dag)).toBe(false);
    expect(dag.roots).toHaveLength(1);
    expect(dag.leaves).toHaveLength(1);
  });

  it('customized transformation + privateTable', () => {
    const r = runner();
    r.registerTable({
      name: 'nums',
      columns: ['v'],
      rows: [{ v: 1 }, { v: 2 }],
    });
    r.dsl.createCustomizedTransformation('plus2', (rows) =>
      rows.map((row) => ({ v: Number(row.v) + 2 })),
    );
    const priv = r.dsl.privateTable('tmp');
    r.dsl.startWith(priv, 'nums');
    r.dsl.transformation(priv, 'custom', { name: 'plus2' });

    const def = r.dsl.newTable('out');
    r.dsl.startWith(def, 'nums');
    r.dsl.transformation(def, 'custom', { name: 'plus2' });
    r.dsl.addPrivateTable(def, priv);

    const prog = r.build(def);
    const result = r.run(prog);
    expect(result.rows.map((x) => x.v)).toEqual([3, 4]);
    expect(prog.computability).toBe('IMPOSSIBLE');
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    const code = runDemo((m) => lines.push(m));
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
