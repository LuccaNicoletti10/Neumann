#!/usr/bin/env node
/**
 * data-lineage — src/cli.ts
 * demo: RAW → transform → DERIVED; upstream/downstream; invalid+propagate; completude 100%.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { LineageChangeEvent } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { hashCanonical } from './core/hash.js';
import { createLineageStore } from './core/store.js';

const USAGE = `data-lineage (lineage) — PASSO 15: lineage por versão
  US 9,996,595 / US 9,348,879 / US20140114907 / US20150012477 / US 10,027,551

Uso:
  lineage demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const events: LineageChangeEvent[] = [];
  const clock = createDeterministicClock('2024-06-01T12:00:00.000Z');
  const store = createLineageStore({
    clock,
    nextId: createIdGenerator(),
    onChange: (e) => events.push(e),
  });

  log('== 1. RAW datasets (origem) ==');
  const salesHash = hashCanonical({ rows: [{ id: 1, amount: 100 }] });
  const custHash = hashCanonical({ rows: [{ id: 'c1', name: 'Acme' }] });
  store.registerRaw({
    versionId: 'sales-v1',
    datasetId: 'sales',
    datasetName: 'sales',
    versionNumber: 1,
    contentHash: salesHash,
    createdBy: 'connector-csv',
  });
  store.registerRaw({
    versionId: 'customers-v1',
    datasetId: 'customers',
    datasetName: 'customers',
    versionNumber: 1,
    contentHash: custHash,
    createdBy: 'connector-csv',
  });
  log(`  sales-v1 hash=${salesHash.slice(0, 12)}…`);
  log(`  customers-v1 hash=${custHash.slice(0, 12)}…`);

  log('== 2. pipeline_run: join → orders_enriched ==');
  const outHash = hashCanonical({
    rows: [{ id: 1, amount: 100, customer: 'Acme' }],
  });
  const run = store.recordRun({
    inputVersions: ['sales-v1', 'customers-v1'],
    outputVersion: 'orders-enriched-v1',
    datasetId: 'orders_enriched',
    datasetName: 'orders_enriched',
    versionNumber: 1,
    derivationProgramId: 'xform-join-sales-customers-v1',
    contentHash: outHash,
    durationMs: 120,
    createdBy: 'svc-pipeline',
  });
  log(`  run=${run.id} inputs=${run.inputVersions.join(',')} → ${run.outputVersion}`);
  log(`  durationMs=${run.durationMs} hash=${run.contentHash.slice(0, 12)}…`);

  log('== 3. 2º hop: aggregate ==');
  const aggHash = hashCanonical({ total: 100 });
  store.recordRun({
    inputVersions: ['orders-enriched-v1'],
    outputVersion: 'sales-summary-v1',
    datasetId: 'sales_summary',
    datasetName: 'sales_summary',
    versionNumber: 1,
    derivationProgramId: 'xform-agg-v1',
    contentHash: aggHash,
    durationMs: 30,
  });

  log('== 4. upstream / downstream / fullProvenance ==');
  const up = store.upstream('orders-enriched-v1');
  const down = store.downstream('sales-v1');
  const full = store.fullProvenance('sales-summary-v1');
  log(`  upstream(orders-enriched-v1)=${up.join(',')}`);
  log(`  downstream(sales-v1)=${down.join(',')}`);
  log(`  fullProvenance(sales-summary-v1)=${full.join(',')}`);

  log('== 5. visualize (grafo composto) ==');
  const graph = store.visualize('sales-summary-v1');
  log(`  nodes=${graph.nodes.length} edges=${graph.edges.length}`);
  for (const n of graph.nodes) {
    log(
      `  dataset=${n.datasetName}${n.isTarget ? ' [TARGET]' : ''} versions=${n.versions.map((v) => v.versionId).join(',')}`,
    );
  }

  log('== 6. invalid flag + propagate ==');
  store.flagInvalid('sales-v1', 'source failed validation');
  const affected = store.propagateInvalid('sales-v1');
  log(`  invalid sales-v1 → propagated to ${affected.join(',')}`);
  log(`  summary invalid=${store.getVersion('sales-summary-v1')?.invalid}`);

  log('== 7. completeness gate ==');
  const report = store.completeness();
  log(
    `  complete=${report.complete} derived=${report.totalDerived} withInputs=${report.withInputs} orphans=${report.orphanOutputVersions.length}`,
  );
  log(`  changeEvents=${events.length}`);

  const ok =
    up.length === 2 &&
    down.includes('orders-enriched-v1') &&
    full.includes('sales-v1') &&
    full.includes('customers-v1') &&
    full.includes('orders-enriched-v1') &&
    report.complete &&
    report.totalDerived === 2 &&
    affected.includes('orders-enriched-v1') &&
    affected.includes('sales-summary-v1') &&
    events.some((e) => e.kind === 'run_recorded');

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
  runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
