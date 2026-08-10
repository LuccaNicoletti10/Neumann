#!/usr/bin/env node
// bounded-fair-scheduler — interface de linha de comando (CLI).
// Expõe na linha de comando, de forma independente, os mecanismos da patente
// US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads"): submissão
// de jobs com costEstimate, execução round-robin, consulta da fila limitada +
// waiting queue, cancelamento, comparador fair-bounded vs FCFS, servidor HTTP e
// uma demo de carga mista com fila pequena evidenciando backpressure e latências.
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseManagementSystem } from './core/dbms.js';
import { BoundedFairScheduler } from './core/scheduler.js';
import type { SchedulerSnapshot } from './core/scheduler.js';
import { runComparison } from './core/compare.js';
import { generateRows, ManualClock } from './core/types.js';
import type { QueryJob } from './core/types.js';
import { startServer } from './server/index.js';

const DEFAULT_NODE_NAMES = ['node-A', 'node-B'];
const DEFAULT_ROW_COUNT = 5000;
const DEFAULT_MAX_QUEUE_SIZE = 2;
const DEFAULT_MAX_TASK_SIZE = 50;

interface CliState {
  maxQueueSize: number;
  maxTaskSize: number;
  nodeNames: string[];
  rowCount: number;
  snapshot: SchedulerSnapshot;
}

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

function statePath(flags: Map<string, string>): string {
  return resolve(flags.get('state') ?? '.bfs-state.json');
}

function newDbms(nodeNames: string[], rowCount: number): DatabaseManagementSystem {
  return DatabaseManagementSystem.uniform(nodeNames, generateRows(rowCount));
}

function newScheduler(state: CliState): BoundedFairScheduler {
  const defaultNode = state.nodeNames[0];
  return BoundedFairScheduler.restore(state.snapshot, {
    maxQueueSize: state.maxQueueSize,
    maxTaskSize: state.maxTaskSize,
    clock: new ManualClock(state.snapshot.clockNow),
    dbms: newDbms(state.nodeNames, state.rowCount),
    ...(defaultNode !== undefined ? { defaultNode } : {}),
  });
}

function loadState(flags: Map<string, string>): CliState {
  const path = statePath(flags);
  if (!existsSync(path)) {
    return {
      maxQueueSize: intFlag(flags, 'max-queue-size', DEFAULT_MAX_QUEUE_SIZE),
      maxTaskSize: intFlag(flags, 'max-task-size', DEFAULT_MAX_TASK_SIZE),
      nodeNames: [...DEFAULT_NODE_NAMES],
      rowCount: DEFAULT_ROW_COUNT,
      snapshot: {
        nextSeq: 0,
        clockNow: 0,
        execution: [],
        waiting: [],
        records: [],
        waitingQueueEnqueuedCount: 0,
        promotedFromWaitingCount: 0,
      },
    };
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CliState;
  return parsed;
}

function saveState(flags: Map<string, string>, state: CliState): void {
  const path = statePath(flags);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function persistScheduler(flags: Map<string, string>, state: CliState, scheduler: BoundedFairScheduler): void {
  state.snapshot = scheduler.snapshotState();
  saveState(flags, state);
}

function intFlag(flags: Map<string, string>, name: string, dflt: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`flag --${name} deve ser inteiro >= 1 (recebido: ${raw})`);
  }
  return n;
}

function printQueue(scheduler: BoundedFairScheduler): void {
  const snap = scheduler.queueSnapshot();
  console.log(
    `execution queue (${snap.occupancy}/${snap.maxQueueSize}${snap.isFull ? ', CHEIA' : ''}):`,
  );
  for (const e of snap.execution) console.log(`  #${e.position} ${e.jobId}`);
  for (const id of snap.inFlight) console.log(`  [em voo] ${id}`);
  console.log(`waiting queue (${snap.waiting.length}):`);
  for (const e of snap.waiting) console.log(`  #${e.position} ${e.jobId}`);
}

function printMetrics(scheduler: BoundedFairScheduler): void {
  const summary = scheduler.summary();
  console.log(
    `waitingQueueEnqueuedCount=${summary.waitingQueueEnqueuedCount} ` +
      `promotedFromWaitingCount=${summary.promotedFromWaitingCount} ` +
      `completed=${summary.completedCount} cancelled=${summary.cancelledCount} migrated=${summary.migratedCount}`,
  );
  for (const m of scheduler.listMetrics()) {
    console.log(
      `  ${m.jobId} [${m.status}] node=${m.node} cost=${m.costEstimate} rows=${m.rowsReturned} ` +
        `tasks=${m.tasksExecuted} firstResult=${m.firstResultLatencyMs ?? '-'}ms ` +
        `completion=${m.completionLatencyMs ?? '-'}ms waiting=${m.waitingTimeMs ?? '-'}ms` +
        (m.migratedFrom ? ` (migrado de ${m.migratedFrom})` : ''),
    );
  }
}

function cmdSubmit(flags: Map<string, string>): void {
  const query = flags.get('query');
  const cost = flags.get('cost');
  if (!query) throw new Error('uso: submit --query <texto> --cost <n> [--node <nó>]');
  if (!cost) throw new Error('uso: submit --query <texto> --cost <n> [--node <nó>]');
  const state = loadState(flags);
  const scheduler = newScheduler(state);
  const job: QueryJob = { query, costEstimate: Number(cost) };
  const node = flags.get('node');
  if (node) job.node = node;
  const result = scheduler.submit(job);
  persistScheduler(flags, state, scheduler);
  console.log(JSON.stringify(result));
}

function cmdRun(flags: Map<string, string>): void {
  const state = loadState(flags);
  const scheduler = newScheduler(state);
  const steps = scheduler.runUntilIdle();
  persistScheduler(flags, state, scheduler);
  console.log(`steps executados: ${steps} (filas vazias)`);
  printMetrics(scheduler);
}

function cmdQueue(flags: Map<string, string>): void {
  const state = loadState(flags);
  const scheduler = newScheduler(state);
  printQueue(scheduler);
}

function cmdCancel(flags: Map<string, string>, positional: string[]): void {
  const jobId = positional[0];
  if (!jobId) throw new Error('uso: cancel <jobId>');
  const state = loadState(flags);
  const scheduler = newScheduler(state);
  const ok = scheduler.cancel(jobId);
  persistScheduler(flags, state, scheduler);
  console.log(ok ? `${jobId} cancelado` : `${jobId} não estava enfileirado`);
  printQueue(scheduler);
}

function cmdCompare(flags: Map<string, string>): void {
  const file = flags.get('file');
  if (!file) throw new Error('uso: compare --file jobs.json');
  const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('arquivo deve conter um array não vazio de jobs');
  }
  const jobs = raw as QueryJob[];
  const state = loadState(flags);
  const report = runComparison(jobs, {
    dbms: newDbms(state.nodeNames, state.rowCount),
    maxQueueSize: state.maxQueueSize,
    maxTaskSize: state.maxTaskSize,
  });
  console.log(JSON.stringify(report, null, 2));
}

async function cmdServe(flags: Map<string, string>): Promise<void> {
  const port = intFlag(flags, 'port', 8080);
  const host = flags.get('host') ?? '127.0.0.1';
  const state = loadState(flags);
  const scheduler = newScheduler(state);
  const started = await startServer(port, host, {
    scheduler,
    dbms: newDbms(state.nodeNames, state.rowCount),
    maxTaskSize: state.maxTaskSize,
    maxQueueSize: state.maxQueueSize,
  });
  console.log(`bounded-fair-scheduler ouvindo em ${started.url}`);
}

function cmdDemo(): void {
  const rowCount = 1000;
  const maxQueueSize = 2;
  const maxTaskSize = 50;
  const dbms = newDbms(['node-A', 'node-B'], rowCount);
  const clock = new ManualClock(0);
  const scheduler = new BoundedFairScheduler({
    maxQueueSize,
    maxTaskSize,
    clock,
    dbms,
    defaultNode: 'node-A',
  });

  const jobs: QueryJob[] = [
    { query: 'SELECT * FROM vendas -- relatorio pesado', costEstimate: 1000 },
    { query: 'SELECT * FROM usuarios WHERE id = ?', costEstimate: 10 },
    { query: 'SELECT * FROM pedidos WHERE status = ?', costEstimate: 10 },
    { query: 'SELECT * FROM produtos WHERE sku = ?', costEstimate: 10 },
    { query: 'SELECT * FROM sessoes WHERE token = ?', costEstimate: 10 },
  ];

  console.log('=== DEMO: carga mista (1 job de 1000 resultados + 4 de 10) com fila maxQueueSize=2 ===');
  console.log('--- admissão (backpressure) ---');
  for (const job of jobs) {
    const r = scheduler.submit(job);
    console.log(`  ${r.jobId} cost=${job.costEstimate} → admitted=${r.admitted}`);
  }
  printQueue(scheduler);

  console.log('--- execução round-robin até esvaziar ---');
  const steps = scheduler.runUntilIdle();
  console.log(`steps: ${steps}`);
  printMetrics(scheduler);

  console.log('--- comparador fair-bounded vs FCFS ---');
  const report = runComparison(jobs, { dbms, maxQueueSize, maxTaskSize });
  console.log(
    `  jobs de baixo custo (cost <= ${report.lowCost.threshold}): ${report.lowCost.count}`,
  );
  console.log(
    `  conclusão média low-cost → fair-bounded: ${report.lowCost.fairBoundedAvgCompletionMs}ms | FCFS: ${report.lowCost.fcfsAvgCompletionMs}ms`,
  );
  console.log(
    `  redução de latência low-cost: ${report.lowCost.completionLatencyReductionPct?.toFixed(1)}%`,
  );
}

function printHelp(): void {
  console.log(`bounded-fair-scheduler — CLI

Uso:
  submit --query <texto> --cost <n> [--node <nó>] [--state <arquivo>]
  run [--state <arquivo>]
  queue [--state <arquivo>]
  cancel <jobId> [--state <arquivo>]
  compare --file jobs.json [--state <arquivo>]
  serve [--port <n>] [--host <h>] [--state <arquivo>]
  demo
  help

Flags globais:
  --state <arquivo>       arquivo de estado (default: .bfs-state.json)
  --max-queue-size <n>    tamanho máximo da execution queue (default: 2, só no 1º uso)
  --max-task-size <n>     teto do rate limiter por sub-tarefa (default: 50, só no 1º uso)`);
}

export async function main(argv: string[]): Promise<void> {
  const { command, positional, flags } = parseArgs(argv);
  switch (command) {
    case 'submit':
      cmdSubmit(flags);
      return;
    case 'run':
      cmdRun(flags);
      return;
    case 'queue':
      cmdQueue(flags);
      return;
    case 'cancel':
      cmdCancel(flags, positional);
      return;
    case 'compare':
      cmdCompare(flags);
      return;
    case 'serve':
      await cmdServe(flags);
      return;
    case 'demo':
      cmdDemo();
      return;
    case 'help':
    default:
      printHelp();
  }
}

const invokedAsScript =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('/cli.ts') ||
    process.argv[1].endsWith('/cli.js') ||
    process.argv[1].endsWith('bounded-fair-scheduler'));

if (invokedAsScript) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}