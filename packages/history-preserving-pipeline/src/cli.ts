#!/usr/bin/env node
/**
 * history-preserving-pipeline — src/cli.ts
 * demo determinístico: create → tx → commit → build → trace → duplicate commit.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createHistoryPreservingPipeline } from './core/system.js';

const USAGE = `history-preserving-pipeline (hpp/ds) — PASSO 8: Dataset Store imutável
  US 9,229,952 / US 9,483,506 / US 9,946,738

Uso:
  hpp demo
  ds demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const pipe = createHistoryPreservingPipeline({ clock, nextId });

  log('== 1. createDataset (raw + derived) ==');
  const raw = pipe.createDataset({ name: 'orders_raw', description: 'pedidos brutos' });
  const derived = pipe.createDataset({ name: 'orders_agg', description: 'agregado' });
  log(`  raw=${raw.id} derived=${derived.id}`);

  log('== 2. transaction start → write → commit ==');
  const tx = pipe.startTransaction(raw.id, { schemaVersion: '1', createdBy: 'demo' });
  pipe.writeTransaction(tx.id, { rows: [{ id: 1, total: 10 }, { id: 2, total: 20 }] });
  const v1 = pipe.commitTransaction(tx.id);
  log(
    `  version=${v1.id} n=${v1.versionNumber} hash=${v1.contentHash.slice(0, 12)}…` +
      ` policyId=${String(v1.policyId)} lineageRef=${String(v1.lineageRef)}`,
  );

  log('== 3. registerProgram + buildDataset ==');
  const prog = pipe.registerProgram(
    {
      name: 'sum_totals',
      inputDatasetIds: [raw.id],
      outputDatasetId: derived.id,
      schemaVersion: '1',
    },
    (inputs) => {
      const payload = inputs[0] as { rows: Array<{ id: number; total: number }> };
      const sum = payload.rows.reduce((acc, r) => acc + r.total, 0);
      return { sum, count: payload.rows.length };
    },
  );
  log(`  program=${prog.id} outOfDate=${String(pipe.isOutOfDate(prog.id))}`);
  const built = pipe.buildDataset(prog.id);
  log(
    `  built=${built.id} n=${built.versionNumber} transformationId=${built.transformationId}` +
      ` inputs=${built.inputVersions.join(',')}`,
  );
  log(`  outOfDateAfterBuild=${String(pipe.isOutOfDate(prog.id))}`);

  log('== 4. mutate raw → isOutOfDate → processQueue ==');
  const tx2 = pipe.startTransaction(raw.id, {
    parentVersion: v1.id,
    schemaVersion: '1',
    createdBy: 'demo',
  });
  pipe.writeTransaction(tx2.id, {
    rows: [
      { id: 1, total: 10 },
      { id: 2, total: 20 },
      { id: 3, total: 5 },
    ],
  });
  const v2 = pipe.commitTransaction(tx2.id);
  pipe.build.enqueueDependents(raw.id);
  log(`  rawV2=${v2.id} outOfDate=${String(pipe.isOutOfDate(prog.id))} queue=${pipe.build.getQueue().join(',')}`);
  const rebuilt = pipe.processQueue();
  log(`  rebuilt=${rebuilt.map((v) => v.id).join(',') || '(none)'}`);

  log('== 5. traceDatasetHistory ==');
  const latestDerived = pipe.getLatestVersion(derived.id)!;
  const trace = pipe.traceDatasetHistory(latestDerived.id);
  log(
    `  root=${trace.versionId} children=${trace.children.length}` +
      ` transform=${trace.transformationId ?? '-'}`,
  );

  log('== 6. compareVersions + duplicate contentHash ==');
  const versions = pipe.listVersions(raw.id);
  const diff = pipe.compareVersions(versions[0]!.id, versions[1]!.id);
  log(
    `  diff sameContent=${String(diff.sameContent)} changed=${diff.changedKeys.join(',') || '-'}`,
  );

  const txDup = pipe.startTransaction(raw.id, {
    parentVersion: v2.id,
    schemaVersion: '1',
    createdBy: 'demo',
  });
  // mesmo payload de v2 → mesmo contentHash → mesma versionId
  pipe.writeTransaction(txDup.id, {
    rows: [
      { id: 1, total: 10 },
      { id: 2, total: 20 },
      { id: 3, total: 5 },
    ],
  });
  const dup = pipe.commitTransaction(txDup.id);
  log(`  duplicateCommit versionId=${dup.id} equalsV2=${String(dup.id === v2.id)}`);
  log(`  versionCountRaw=${pipe.listVersions(raw.id).length}`);

  log('== demo ok ==');
  return 0;
}

export async function runCommandLine(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  try {
    switch (cmd) {
      case 'demo':
        return runDemo(log);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        log(USAGE);
        return cmd === undefined ? 2 : 0;
      default:
        error(USAGE);
        return 2;
    }
  } catch (err) {
    error(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
