#!/usr/bin/env node
/**
 * data-quality — src/cli.ts
 * demo: métricas pós-run + regra → quarentena com motivo + composite join.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { QualityRule } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createDataQualityEngine } from './core/engine.js';

const USAGE = `data-quality (dq) — PASSO 13: quality + rules + quarantine + composite
  US 11,429,572 / US 9,542,446 / US 10,678,860

Uso:
  dq demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock('2024-06-01T12:00:00.000Z');
  const eng = createDataQualityEngine({
    clock,
    nextId: createIdGenerator(),
    now: '2024-06-01T12:00:00.000Z',
  });

  log('== 1. register datasets ==');
  eng.registerDataset({
    id: 'orders',
    name: 'orders',
    version: 1,
    columns: ['id', 'status', 'amount', 'region'],
    updatedAt: '2024-06-01T11:00:00.000Z',
    rows: [
      { id: 1, status: 'active', amount: 100, region: 'BR' },
      { id: 2, status: 'active', amount: null, region: 'BR' },
      { id: null, status: 'closed', amount: 50, region: 'US' },
      { id: 4, status: 'active', amount: 80, region: 'BR' },
      { id: 4, status: 'active', amount: 10, region: 'BR' },
    ],
  });
  eng.registerDataset({
    id: 'regions',
    name: 'regions',
    version: 1,
    columns: ['code', 'name'],
    updatedAt: '2024-06-01T11:00:00.000Z',
    rows: [
      { code: 'BR', name: 'Brazil' },
      { code: 'US', name: 'United States' },
    ],
  });

  log('== 2. rules (condition/severity/action/scope/version/owner) ==');
  const rules: QualityRule[] = [
    {
      id: 'r-id-null',
      name: 'id required',
      condition: { kind: 'not_null', column: 'id' },
      severity: 'quarantine',
      action: { kind: 'quarantine' },
      scope: 'orders',
      version: 1,
      owner: 'platform',
      active: true,
    },
    {
      id: 'r-id-unique',
      name: 'id unique',
      condition: { kind: 'unique', column: 'id' },
      severity: 'quarantine',
      action: { kind: 'quarantine' },
      scope: 'orders',
      version: 1,
      owner: 'platform',
      active: true,
    },
    {
      id: 'r-amount-type',
      name: 'amount is number',
      condition: { kind: 'type', column: 'amount', type: 'number' },
      severity: 'quarantine',
      action: { kind: 'quarantine' },
      scope: 'orders',
      version: 1,
      owner: 'data-eng',
      active: true,
    },
  ];
  for (const r of rules) eng.addRule(r);
  log(`  rules=${eng.listRules().length}`);

  log('== 3. post-run quality + quarantine ==');
  const result = eng.run('orders', {
    validityColumns: [{ column: 'amount', type: 'number' }],
    freshnessMaxAgeSeconds: 7200,
  });
  log(`  overall=${result.report.overall.toFixed(3)} violations=${result.report.violationCount}`);
  for (const s of result.report.scores) {
    log(`  ${s.dimension}=${s.score.toFixed(3)}${s.detail ? ` (${s.detail})` : ''}`);
  }
  log(`  cleanRows=${result.cleanRows.length} quarantined=${result.quarantined.length}`);
  for (const q of result.quarantined) {
    log(`  Q ${q.id}: row=${q.rowIndex} reason=${q.reason}`);
  }

  log('== 4. composite dataset (multi-input join) ==');
  const composite = eng.defineComposite({
    id: 'orders_regions',
    name: 'orders_regions',
    sourceDatasetIds: ['orders', 'regions'],
    joinKeys: [
      {
        leftDatasetId: 'orders',
        leftColumn: 'region',
        rightDatasetId: 'regions',
        rightColumn: 'code',
      },
    ],
  });
  log(`  composite rows=${composite.rows.length} cols=${composite.columns.join(',')}`);

  const q = eng.listQuarantine('orders');
  const ok =
    result.quarantined.length >= 1 &&
    q.every((x) => typeof x.reason === 'string' && x.reason.length > 0) &&
    result.report.scores.length === 6 &&
    composite.rows.length >= 1;

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
  if (cmd === 'demo') return runDemo(log);
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
