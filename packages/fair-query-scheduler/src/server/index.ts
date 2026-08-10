/**
 * fair-query-scheduler — src/server/index.ts
 *
 * Servidor HTTP de referência (somente node:http, ZERO dependências) que expõe
 * os mecanismos do escalonador justo derivados da patente US 9.092.482 B2:
 * submissão de job requests com estimativa de custo, consulta de estado e
 * resultados agregados, cancelamento (remoção do job item da fila), migração
 * de nó (continuação em nó diferente) e comparação de latências FCFS × fair.
 *
 * Rotas:
 *   GET  /health                → { ok: true }
 *   POST /jobs                  → { jobId }            body: {query, costEstimate, params?}
 *   GET  /jobs/:id              → estado + resultados  (antes de responder, o
 *                                  servidor drena a fila — simulação dirigida
 *                                  pelo Clock injetável, sem timers reais)
 *   POST /jobs/:id/cancel       → { ok, state }
 *   POST /jobs/:id/migrate      → { ok, node }         body: { toNode }
 *   POST /compare               → métricas FCFS × fair body: { jobs: [...], thresholdCost?, tables? }
 *
 * Corpos maiores que MAX_BODY (8 MB) → 413; JSON inválido → 400;
 * rota/job desconhecido → 404.
 */

import http from 'node:http';
import { runComparison } from '../core/compare.js';
import { DatabaseManagementSystem, DatabaseNode } from '../core/dbms.js';
import { FairScheduler } from '../core/scheduler.js';
import { FakeClock } from '../core/types.js';
import type { JobRequest, QueryJob, Row } from '../core/types.js';

export const MAX_BODY = 8 * 1024 * 1024; // 8 MB

export interface ServerDeps {
  scheduler: FairScheduler;
  dbms: DatabaseManagementSystem;
  /** Threshold padrão usado por /compare quando o corpo não informa. */
  thresholdCost: number;
}

/** DBMS de demonstração: dois nós com a tabela "events" (1000 linhas). */
export function createDemoDeps(thresholdCost = 100): ServerDeps {
  const rows: Row[] = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, value: `event-${i + 1}` }));
  const nodeA = new DatabaseNode('node-a', { events: rows });
  const nodeB = new DatabaseNode('node-b', { events: rows });
  const dbms = new DatabaseManagementSystem([nodeA, nodeB]);
  const scheduler = new FairScheduler({ dbms, clock: new FakeClock(0), thresholdCost });
  return { scheduler, dbms, thresholdCost };
}

function serializeJob(job: QueryJob): Record<string, unknown> {
  return {
    id: job.id,
    query: job.request.query,
    costEstimate: job.costEstimate,
    split: job.split,
    limit: job.limit,
    state: job.state,
    node: job.node,
    rowCount: job.rows.length,
    rows: job.rows,
    tasksExecuted: job.tasksExecuted,
    migrations: job.migrations,
    metrics: {
      firstResultLatencyMs: job.firstResultAt === undefined ? null : job.firstResultAt - job.createdAt,
      completionTimeMs: job.completedAt === undefined ? null : job.completedAt - job.createdAt,
    },
    taskLog: job.taskLog,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('corpo excede MAX_BODY (8 MB)'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function asJobRequest(value: unknown): JobRequest {
  if (typeof value !== 'object' || value === null) throw Object.assign(new Error('job inválido'), { statusCode: 400 });
  const v = value as Record<string, unknown>;
  if (typeof v['query'] !== 'string' || v['query'].length === 0) {
    throw Object.assign(new Error('campo "query" é obrigatório'), { statusCode: 400 });
  }
  if (typeof v['costEstimate'] !== 'number' || !Number.isFinite(v['costEstimate'])) {
    throw Object.assign(new Error('campo "costEstimate" numérico é obrigatório'), { statusCode: 400 });
  }
  const req: JobRequest = { query: v['query'], costEstimate: v['costEstimate'] };
  if (typeof v['params'] === 'object' && v['params'] !== null) {
    req.params = v['params'] as Record<string, unknown>;
  }
  return req;
}

export function createHandler(deps: ServerDeps): http.RequestListener {
  const { scheduler, dbms } = deps;
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && path === '/jobs') {
        const body = await readBody(req);
        const jobReq = asJobRequest(body);
        const jobId = scheduler.submit(jobReq);
        sendJson(res, 201, { jobId });
        return;
      }

      const jobMatch = /^\/jobs\/([^/]+)(?:\/(cancel|migrate))?$/.exec(path);
      if (jobMatch) {
        const jobId = decodeURIComponent(jobMatch[1]!);
        const action = jobMatch[2];
        const job = scheduler.getJob(jobId);
        if (!job) {
          sendJson(res, 404, { error: `job "${jobId}" não encontrado` });
          return;
        }
        if (method === 'GET' && !action) {
          // Drena a fila antes de responder (simulação sem timers reais).
          await scheduler.runUntilIdle();
          sendJson(res, 200, serializeJob(job));
          return;
        }
        if (method === 'POST' && action === 'cancel') {
          const ok = scheduler.cancel(jobId);
          sendJson(res, 200, { ok, state: job.state });
          return;
        }
        if (method === 'POST' && action === 'migrate') {
          const body = (await readBody(req)) as Record<string, unknown>;
          const toNode = body?.['toNode'];
          if (typeof toNode !== 'string' || !dbms.hasNode(toNode)) {
            sendJson(res, 400, { error: 'campo "toNode" deve ser um nó existente', nodes: dbms.nodeIds });
            return;
          }
          const ok = scheduler.migrate(jobId, toNode);
          sendJson(res, 200, { ok, node: job.node, migrations: job.migrations });
          return;
        }
        sendJson(res, 404, { error: 'rota não encontrada' });
        return;
      }

      if (method === 'POST' && path === '/compare') {
        const body = (await readBody(req)) as Record<string, unknown>;
        const rawJobs = body?.['jobs'];
        if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
          sendJson(res, 400, { error: 'campo "jobs" deve ser um array não vazio' });
          return;
        }
        const jobs = rawJobs.map(asJobRequest);
        const threshold = typeof body?.['thresholdCost'] === 'number'
          ? (body['thresholdCost'] as number)
          : deps.thresholdCost;
        let compareDbms = dbms;
        const tables = body?.['tables'];
        if (typeof tables === 'object' && tables !== null) {
          compareDbms = new DatabaseManagementSystem([
            new DatabaseNode('compare-node', tables as Record<string, Row[]>),
          ]);
        }
        const result = await runComparison(jobs, { dbms: compareDbms, thresholdCost: threshold });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: 'rota não encontrada' });
    } catch (err) {
      const status = typeof (err as { statusCode?: unknown })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export interface StartedServer {
  server: http.Server;
  port: number;
  host: string;
  close: () => Promise<void>;
}

/**
 * Sobe o servidor HTTP. Retorna a PORTA EFETIVA (útil com port 0).
 */
export function startServer(port = 0, host = '127.0.0.1', deps?: ServerDeps): Promise<StartedServer> {
  const d = deps ?? createDemoDeps();
  const server = http.createServer(createHandler(d));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const effectivePort = typeof addr === 'object' && addr !== null ? addr.port : port;
      resolve({
        server,
        port: effectivePort,
        host,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}
