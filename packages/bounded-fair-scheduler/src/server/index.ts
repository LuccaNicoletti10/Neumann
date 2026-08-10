// bounded-fair-scheduler — servidor HTTP (apenas node:http, zero dependências).
// Expõe via HTTP, de forma independente, os mecanismos da patente US 9,715,526 B2
// (Palantir, "Fair Scheduling for Mixed-Query Loads"): submissão de jobs com
// costEstimate, consulta da fila limitada + waiting queue (snapshot com posições),
// cancelamento, migração de nó e comparador fair-bounded vs FCFS.
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { DatabaseManagementSystem } from '../core/dbms.js';
import { runComparison } from '../core/compare.js';
import { BoundedFairScheduler } from '../core/scheduler.js';
import type { QueryJob } from '../core/types.js';

export const MAX_BODY = 8 * 1024 * 1024; // 8 MB

export interface HttpServerOptions {
  scheduler: BoundedFairScheduler;
  dbms: DatabaseManagementSystem;
  maxTaskSize: number;
  maxQueueSize: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload excede MAX_BODY (8MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseJsonBody(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'corpo JSON inválido');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'corpo deve ser um objeto JSON');
  }
  return parsed as Record<string, unknown>;
}

function parseQueryJob(body: Record<string, unknown>): QueryJob {
  const query = body['query'];
  const costEstimate = body['costEstimate'];
  if (typeof query !== 'string' || query.length === 0) {
    throw new HttpError(400, 'campo "query" (string) é obrigatório');
  }
  if (typeof costEstimate !== 'number' || !Number.isInteger(costEstimate) || costEstimate < 1) {
    throw new HttpError(400, 'campo "costEstimate" (inteiro >= 1) é obrigatório');
  }
  const job: QueryJob = { query, costEstimate };
  const params = body['params'];
  if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
    job.params = params as Record<string, unknown>;
  }
  const node = body['node'];
  if (typeof node === 'string' && node.length > 0) job.node = node;
  const id = body['id'];
  if (typeof id === 'string' && id.length > 0) job.id = id;
  return job;
}

async function route(
  opts: HttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { scheduler } = opts;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'bounded-fair-scheduler' });
    return;
  }

  if (method === 'GET' && path === '/queue') {
    sendJson(res, 200, scheduler.queueSnapshot());
    return;
  }

  if (method === 'GET' && path === '/summary') {
    sendJson(res, 200, scheduler.summary());
    return;
  }

  if (method === 'POST' && path === '/jobs') {
    const job = parseQueryJob(parseJsonBody(await readBody(req)));
    const result = scheduler.submit(job);
    sendJson(res, 201, result);
    return;
  }

  if (method === 'POST' && path === '/run') {
    const body = parseJsonBody(await readBody(req));
    const stepsRaw = body['steps'];
    let executed: number;
    if (stepsRaw === undefined) {
      executed = scheduler.runUntilIdle();
    } else {
      if (typeof stepsRaw !== 'number' || !Number.isInteger(stepsRaw) || stepsRaw < 1) {
        throw new HttpError(400, 'campo "steps" deve ser inteiro >= 1');
      }
      executed = 0;
      for (let i = 0; i < stepsRaw; i += 1) {
        if (!scheduler.step()) break;
        executed += 1;
      }
    }
    sendJson(res, 200, { stepsExecuted: executed, queue: scheduler.queueSnapshot() });
    return;
  }

  if (method === 'POST' && path === '/compare') {
    const body = parseJsonBody(await readBody(req));
    const jobsRaw = body['jobs'];
    if (!Array.isArray(jobsRaw) || jobsRaw.length === 0) {
      throw new HttpError(400, 'campo "jobs" (array não vazio) é obrigatório');
    }
    const jobs = jobsRaw.map((j) => {
      if (typeof j !== 'object' || j === null || Array.isArray(j)) {
        throw new HttpError(400, 'cada item de "jobs" deve ser um objeto');
      }
      return parseQueryJob(j as Record<string, unknown>);
    });
    const report = runComparison(jobs, {
      dbms: opts.dbms,
      maxQueueSize: opts.maxQueueSize,
      maxTaskSize: opts.maxTaskSize,
    });
    sendJson(res, 200, report);
    return;
  }

  const jobMatch = /^\/jobs\/([^/]+)(\/cancel|\/migrate)?$/.exec(path);
  if (jobMatch) {
    const jobId = decodeURIComponent(jobMatch[1] ?? '');
    const action = jobMatch[2] ?? '';
    if (method === 'GET' && action === '') {
      const metrics = scheduler.getMetrics(jobId);
      if (!metrics) throw new HttpError(404, `job não encontrado: ${jobId}`);
      sendJson(res, 200, metrics);
      return;
    }
    if (method === 'POST' && action === '/cancel') {
      const ok = scheduler.cancel(jobId);
      if (!ok) throw new HttpError(404, `job não está enfileirado: ${jobId}`);
      sendJson(res, 200, { jobId, cancelled: true, queue: scheduler.queueSnapshot() });
      return;
    }
    if (method === 'POST' && action === '/migrate') {
      const body = parseJsonBody(await readBody(req));
      const toNode = body['toNode'];
      if (typeof toNode !== 'string' || toNode.length === 0) {
        throw new HttpError(400, 'campo "toNode" (string) é obrigatório');
      }
      try {
        const result = scheduler.migrate(jobId, toNode);
        if (!result) throw new HttpError(404, `job não está enfileirado: ${jobId}`);
        sendJson(res, 200, { ...result, queue: scheduler.queueSnapshot() });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    throw new HttpError(404, 'rota não encontrada');
  }

  throw new HttpError(404, 'rota não encontrada');
}

/** Cria o http.Server sem ouvir porta (útil para testes). */
export function createSchedulerServer(opts: HttpServerOptions): Server {
  return createServer((req, res) => {
    route(opts, req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
}

export interface StartedServer {
  server: Server;
  scheduler: BoundedFairScheduler;
  host: string;
  port: number;
  url: string;
}

/** Sobe o servidor HTTP; port=0 escolhe porta livre (retornada em StartedServer). */
export function startServer(
  port: number,
  host: string,
  opts: HttpServerOptions,
): Promise<StartedServer> {
  const server = createSchedulerServer(opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('falha ao obter endereço do servidor'));
        return;
      }
      resolve({
        server,
        scheduler: opts.scheduler,
        host: addr.address,
        port: addr.port,
        url: `http://${addr.address}:${addr.port}`,
      });
    });
  });
}