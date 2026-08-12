#!/usr/bin/env node
/**
 * incremental-pipeline-scheduler — src/cli.ts
 * demo: R1–R4 arrivals → só descendentes afetados (gate Passo 12).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { seedPatentFigure2b } from './core/fixture.js';
import { createIncrementalPipelineScheduler } from './core/scheduler.js';
import { CycleError } from './core/dag.js';

const USAGE = `incremental-pipeline-scheduler (ips/dagsched) — PASSO 12: DAG + build incremental
  US 11,314,698

Uso:
  ips demo
  dagsched demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export function runDemo(log: (message: string) => void = console.log): number {
  const sched = createIncrementalPipelineScheduler({
    clock: createDeterministicClock('2024-01-01T01:00:00.000Z'),
    nextId: createIdGenerator(),
  });
  seedPatentFigure2b(sched);

  log('== 1. DAG FIGURA 2B ==');
  log('  R1→D1  R3→D2  R4→D3  D1+D2→D4  D3→D5  D4+D5→D6  (R2 isolado)');

  log('== 2. arrivals ==');
  const t1 = sched.commitArrival('R1', { t: '01:00' });
  log(`  R1 → rebuilt=[${t1.rebuiltDatasetIds.join(',')}] partial=[${t1.partialDependencyIds.join(',')}]`);

  const t2 = sched.commitArrival('R2', { t: '04:00' });
  log(`  R2 → rebuilt=[${t2.rebuiltDatasetIds.join(',')}] (esperado vazio)`);

  const t3 = sched.commitArrival('R3', { t: '05:30' });
  log(`  R3 → rebuilt=[${t3.rebuiltDatasetIds.join(',')}] partial=[${t3.partialDependencyIds.join(',')}]`);

  const t4 = sched.commitArrival('R4', { t: '10:00' });
  log(`  R4 → rebuilt=[${t4.rebuiltDatasetIds.join(',')}]`);

  log('== 3. statuses ==');
  for (const ds of sched.listDatasets()) {
    log(`  ${ds.name}: ${ds.buildStatus} v${ds.version}`);
  }

  log('== 4. cycle detection ==');
  let cycleOk = false;
  try {
    sched.addEdge({ sourceId: 'D6', targetId: 'D1' });
  } catch (e) {
    cycleOk = e instanceof CycleError;
    log(`  cycleRejected=${String(cycleOk)}`);
  }

  log('== 5. critical + groups ==');
  sched.markCritical('D6');
  sched.addToGroup('g1', 'R1', 'NON_DIRECTIONAL_GROUP');
  sched.addToGroup('g1', 'R2', 'NON_DIRECTIONAL_GROUP');
  log(`  D6.critical=${String(sched.getDataset('D6')?.critical)}`);

  const ok =
    t1.rebuiltDatasetIds.join(',') === 'D1' &&
    t2.rebuiltDatasetIds.length === 0 &&
    t3.rebuiltDatasetIds.includes('D2') &&
    t3.rebuiltDatasetIds.includes('D4') &&
    t4.rebuiltDatasetIds.includes('D3') &&
    t4.rebuiltDatasetIds.includes('D5') &&
    t4.rebuiltDatasetIds.includes('D6') &&
    sched.hasArrived('D6') &&
    cycleOk;

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
  runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
