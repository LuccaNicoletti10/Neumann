#!/usr/bin/env node
/**
 * transformation-runner — src/cli.ts
 * demo: DSL → SQL versionado → hash gate (mesmo input → mesmo hash).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createTransformationRunner } from './core/runner.js';

const USAGE = `transformation-runner (xform/tr) — PASSO 11: SQL versionado + DSL
  US 9,576,015 / US 9,965,534 / US20170068698A1 / US 9,922,108 / US 10,776,382

Uso:
  xform demo
  tr demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock('2024-01-01T00:00:00.000Z');
  const runner = createTransformationRunner({
    clock,
    nextId: createIdGenerator(),
    engine: 'memory',
  });

  log('== 1. origin tables ==');
  runner.registerTable({
    name: 'orders',
    columns: ['id', 'status', 'amount', 'region'],
    rows: [
      { id: 1, status: 'active', amount: 100, region: 'BR' },
      { id: 2, status: 'closed', amount: 50, region: 'BR' },
      { id: 3, status: 'active', amount: 200, region: 'US' },
      { id: 4, status: 'active', amount: 80, region: 'BR' },
    ],
  });
  runner.registerTable({
    name: 'regions',
    columns: ['code', 'name'],
    rows: [
      { code: 'BR', name: 'Brazil' },
      { code: 'US', name: 'United States' },
    ],
  });
  log('  orders=4 regions=2');

  log('== 2. TableDefinition DSL ==');
  const def = runner.dsl.newTable('active_br_orders');
  runner.dsl.startWith(def, 'orders');
  runner.dsl.transformation(def, 'filter', {
    column: 'status',
    values: ['active'],
  });
  runner.dsl.transformation(def, 'filter', {
    column: 'region',
    values: ['BR'],
  });
  runner.dsl.transformation(def, 'join', {
    right: 'regions',
    leftKey: 'region',
    rightKey: 'code',
  });
  runner.dsl.transformation(def, 'select', {
    columns: ['id', 'amount', 'name'],
  });
  runner.dsl.transformation(def, 'sort', { column: 'id', ascending: true });

  const program = runner.build(def, 1);
  log(`  program=${program.id} v${program.version}`);
  log(`  computability=${program.computability} status=${program.incrementalStatus}`);
  log(`  sql=\n${program.sql.trim()}`);

  log('== 3. execute + determinism gate ==');
  const run1 = runner.run(program);
  const gate = runner.assertDeterministic(program);
  log(`  rows=${run1.rowCount} hash=${run1.contentHash.slice(0, 12)}…`);
  log(`  sameHash=${String(gate.ok)} mode=${run1.mode}`);
  for (const row of run1.rows) {
    log(`  row id=${String(row.id)} amount=${String(row.amount)} name=${String(row.name)}`);
  }

  log('== 4. DAG ==');
  const dag = runner.dagFor(program);
  log(`  nodes=${dag.nodes.size} roots=${dag.roots.length} leaves=${dag.leaves.length}`);

  log('== 5. customized transformation ==');
  runner.dsl.createCustomizedTransformation('bumpAmount', (rows) =>
    rows.map((r) => ({ ...r, amount: Number(r.amount) + 2 })),
  );
  const def2 = runner.dsl.newTable('bumped');
  runner.dsl.startWith(def2, 'orders');
  runner.dsl.transformation(def2, 'filter', {
    column: 'status',
    values: ['active'],
  });
  runner.dsl.transformation(def2, 'custom', { name: 'bumpAmount' });
  const prog2 = runner.build(def2, 1);
  const run2 = runner.run(prog2);
  log(`  customHash=${run2.contentHash.slice(0, 12)}… rows=${run2.rowCount}`);
  log(`  canIncremental(sort pipeline)=${String(runner.canIncremental(program))}`);
  log(`  canIncremental(custom)=${String(runner.canIncremental(prog2))}`);

  const ok =
    gate.ok &&
    run1.rowCount === 2 &&
    run1.contentHash === gate.hash &&
    Number(run1.rows[0]?.amount) === 100;

  log(ok ? '== demo ok ==' : '== demo FAIL ==');
  return ok ? 0 : 1;
}

export async function runCommandLine(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') {
    return runDemo(log);
  }
  error(`comando desconhecido: ${cmd}`);
  log(USAGE);
  return 1;
}

function isMain(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  void runCommandLine(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
      process.exitCode = 1;
    },
  );
}
