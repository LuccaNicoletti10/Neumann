#!/usr/bin/env node
/**
 * fair-query-scheduler — src/cli.ts
 *
 * Interface de linha de comando (CLI) que expõe os mecanismos do escalonador
 * justo derivados da patente US 9.092.482 B2: submissão de job requests com
 * estimativa de custo, execução da fila (modo fair ou FCFS), cancelamento,
 * comparação de latências FCFS × fair, servidor HTTP e uma demonstração
 * (`demo`) com carga mista embutida mostrando a latência de um job pequeno
 * com e sem fair scheduling.
 *
 * Uso:
 *   fair-query-scheduler demo
 *   fair-query-scheduler submit --query <tabela> --cost <n> [--params <json>] [--table-size <n>]
 *   fair-query-scheduler run [--mode fair|fcfs] [--threshold <n>] --file <jobs.json>
 *   fair-query-scheduler cancel <jobId> --file <jobs.json>
 *   fair-query-scheduler compare --file <jobs.json> [--threshold <n>]
 *   fair-query-scheduler serve --port <n> [--host <h>]
 *
 * Formato de jobs.json:
 *   { "tables": { "t": [{"id":1,"value":"a"}, ...] },        // opcional
 *     "tableSizes": { "t": 1000 },                            // opcional (gera linhas)
 *     "thresholdCost": 100,                                   // opcional
 *     "jobs": [ { "query": "t", "costEstimate": 1000 }, ... ] }
 */

import { readFile } from 'node:fs/promises';
import { runComparison } from './core/compare.js';
import { DatabaseManagementSystem, DatabaseNode } from './core/dbms.js';
import { FairScheduler } from './core/scheduler.js';
import { FakeClock } from './core/types.js';
import type { JobRequest, Row } from './core/types.js';
import { startServer } from './server/index.js';

const DEFAULT_THRESHOLD = 100;

function genRows(n: number, prefix = 'row'): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, value: `${prefix}-${i + 1}` }));
}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (v === undefined || v === 'true') {
    throw new Error(`flag obrigatória ausente: --${name}`);
  }
  return v;
}

function intFlag(flags: Map<string, string>, name: string, fallback: number): number {
  const v = flags.get(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name}: inteiro >= 0 esperado, recebeu "${v}"`);
  return n;
}

interface JobsFile {
  tables?: Record<string, Row[]>;
  tableSizes?: Record<string, number>;
  thresholdCost?: number;
  jobs: JobRequest[];
}

function buildDbmsFromFile(file: JobsFile): DatabaseManagementSystem {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(file.tables ?? {})) tables[name] = rows;
  for (const [name, size] of Object.entries(file.tableSizes ?? {})) {
    if (!(name in tables)) tables[name] = genRows(size);
  }
  if (Object.keys(tables).length === 0) {
    throw new Error('jobs.json deve definir "tables" ou "tableSizes"');
  }
  return new DatabaseManagementSystem([
    new DatabaseNode('node-a', tables),
    new DatabaseNode('node-b', tables),
  ]);
}

async function readJobsFile(path: string): Promise<JobsFile> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as JobsFile).jobs)) {
    throw new Error(`arquivo inválido: ${path} (esperado { jobs: [...] })`);
  }
  return parsed as JobsFile;
}

function printMetrics(title: string, jobs: ReturnType<FairScheduler['metrics']>, totalMs: number): void {
  console.log(title);
  console.log('jobId\tcost\ttasks\trows\t1º resultado (ms)\tconclusão (ms)');
  for (const m of jobs) {
    console.log(
      `${m.jobId}\t${m.costEstimate}\t${m.tasksExecuted}\t${m.rowCount}\t${m.firstResultLatencyMs}\t${m.completionTimeMs}`,
    );
  }
  console.log(`tempo total simulado: ${totalMs} ms`);
}

async function cmdDemo(): Promise<void> {
  const threshold = DEFAULT_THRESHOLD;
  const big: JobRequest = { query: 'events', costEstimate: 1000 };
  const smalls: JobRequest[] = [1, 2, 3].map((i) => ({ query: 'items', costEstimate: 10, params: { label: `small-${i}` } }));
  const load: JobRequest[] = [big, ...smalls];

  const dbms = new DatabaseManagementSystem([
    new DatabaseNode('node-a', { events: genRows(1000), items: genRows(10, 'item') }),
  ]);
  const result = await runComparison(load, { dbms, thresholdCost: threshold });

  console.log('=== demo fair-query-scheduler ===');
  console.log(`carga mista: 1 job grande (${big.costEstimate} resultados) + 3 jobs pequenos (10 resultados)`);
  console.log(`latência simulada: baseMs=5 + perRowMs=1 por linha | threshold=${threshold}\n`);
  printMetrics('--- modo FCFS (sem divisão) ---', result.fcfs.jobs, result.fcfs.totalElapsedMs);
  console.log('');
  printMetrics('--- modo FAIR (round-robin) ---', result.fair.jobs, result.fair.totalElapsedMs);
  console.log('');
  for (let i = 0; i < smalls.length; i++) {
    const fcfsJob = result.fcfs.jobs[i + 1]!;
    const fairJob = result.fair.jobs[i + 1]!;
    console.log(
      `job pequeno ${fairJob.jobId}: conclusão FCFS=${fcfsJob.completionTimeMs} ms → FAIR=${fairJob.completionTimeMs} ms`,
    );
  }
  console.log('\nConclusão: com fair scheduling, jobs de baixo custo completam muito antes,');
  console.log('mesmo concorrendo com um job de alto custo submetido primeiro.');
}

async function cmdSubmit(args: ParsedArgs): Promise<void> {
  const query = requireFlag(args.flags, 'query');
  const cost = intFlag(args.flags, 'cost', -1);
  if (cost < 0) throw new Error('flag obrigatória: --cost <n>');
  const tableSize = intFlag(args.flags, 'table-size', Math.max(cost, DEFAULT_THRESHOLD * 10));
  const paramsRaw = args.flags.get('params');
  const params = paramsRaw !== undefined
    ? (JSON.parse(paramsRaw) as Record<string, unknown>)
    : undefined;

  const dbms = new DatabaseManagementSystem([
    new DatabaseNode('node-a', { [query]: genRows(tableSize) }),
    new DatabaseNode('node-b', { [query]: genRows(tableSize) }),
  ]);
  const scheduler = new FairScheduler({ dbms, clock: new FakeClock(0), thresholdCost: DEFAULT_THRESHOLD });
  const req: JobRequest = { query, costEstimate: cost };
  if (params) req.params = params;
  const jobId = scheduler.submit(req);
  await scheduler.runUntilIdle();
  const res = await scheduler.result(jobId);
  console.log(`jobId: ${res.jobId}`);
  console.log(`estado: ${res.state}`);
  console.log(`linhas retornadas: ${res.rows.length}`);
  console.log(`tasks executadas: ${res.metrics.tasksExecuted}`);
  console.log(`latência até 1º resultado: ${res.metrics.firstResultLatencyMs} ms`);
  console.log(`tempo de conclusão: ${res.metrics.completionTimeMs} ms`);
}

async function cmdRun(args: ParsedArgs): Promise<void> {
  const file = await readJobsFile(requireFlag(args.flags, 'file'));
  const mode = args.flags.get('mode') ?? 'fair';
  if (mode !== 'fair' && mode !== 'fcfs') throw new Error('--mode deve ser fair|fcfs');
  const threshold = mode === 'fcfs'
    ? Number.POSITIVE_INFINITY
    : intFlag(args.flags, 'threshold', file.thresholdCost ?? DEFAULT_THRESHOLD);

  const dbms = buildDbmsFromFile(file);
  const clock = new FakeClock(0);
  const scheduler = new FairScheduler({ dbms, clock, thresholdCost: threshold });
  const ids = file.jobs.map((j) => scheduler.submit(j));
  await scheduler.runUntilIdle();
  console.log(`modo: ${mode} | jobs submetidos: ${ids.join(', ')}`);
  printMetrics('--- métricas ---', scheduler.metrics(), clock.now());
}

async function cmdCancel(args: ParsedArgs): Promise<void> {
  const jobId = args.positional[0];
  if (!jobId) throw new Error('uso: cancel <jobId> --file <jobs.json>');
  const file = await readJobsFile(requireFlag(args.flags, 'file'));
  const threshold = intFlag(args.flags, 'threshold', file.thresholdCost ?? DEFAULT_THRESHOLD);

  const dbms = buildDbmsFromFile(file);
  const scheduler = new FairScheduler({ dbms, clock: new FakeClock(0), thresholdCost: threshold });
  const ids = file.jobs.map((j) => scheduler.submit(j));
  if (!ids.includes(jobId)) throw new Error(`job "${jobId}" não está entre os submetidos: ${ids.join(', ')}`);
  const ok = scheduler.cancel(jobId);
  console.log(`cancel(${jobId}): ${ok ? 'removido da fila e marcado como cancelled' : 'falhou (já finalizado?)'}`);
  await scheduler.runUntilIdle();
  printMetrics('--- estado final ---', scheduler.metrics(), 0);
}

async function cmdCompare(args: ParsedArgs): Promise<void> {
  const file = await readJobsFile(requireFlag(args.flags, 'file'));
  const threshold = intFlag(args.flags, 'threshold', file.thresholdCost ?? DEFAULT_THRESHOLD);
  const dbms = buildDbmsFromFile(file);
  const result = await runComparison(file.jobs, { dbms, thresholdCost: threshold });
  printMetrics('--- modo FCFS (sem divisão) ---', result.fcfs.jobs, result.fcfs.totalElapsedMs);
  console.log('');
  printMetrics('--- modo FAIR (round-robin) ---', result.fair.jobs, result.fair.totalElapsedMs);
}

async function cmdServe(args: ParsedArgs): Promise<void> {
  const port = intFlag(args.flags, 'port', 8080);
  const host = args.flags.get('host') ?? '127.0.0.1';
  const started = await startServer(port, host);
  console.log(`fair-query-scheduler HTTP em http://${started.host}:${started.port}`);
  console.log('rotas: GET /health · POST /jobs · GET /jobs/:id · POST /jobs/:id/cancel · POST /jobs/:id/migrate · POST /compare');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case 'demo':
      await cmdDemo();
      break;
    case 'submit':
      await cmdSubmit(args);
      break;
    case 'run':
      await cmdRun(args);
      break;
    case 'cancel':
      await cmdCancel(args);
      break;
    case 'compare':
      await cmdCompare(args);
      break;
    case 'serve':
      await cmdServe(args);
      break;
    case undefined:
    case 'help':
    case '--help':
      console.log('comandos: demo | submit --query <t> --cost <n> | run [--mode fair|fcfs] --file f.json | cancel <id> --file f.json | compare --file f.json | serve --port <n>');
      break;
    default:
      throw new Error(`comando desconhecido: ${command}`);
  }
}

main().catch((err: unknown) => {
  console.error(`erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
