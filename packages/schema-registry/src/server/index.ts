/**
 * schema-registry — src/server/index.ts
 * API HTTP: registry, observe/drift, discover, mapping suggestions.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { createDeterministicClock, createIdGenerator } from '../core/determinism.js';
import { discover, parseCsvSample } from '../core/discover.js';
import { createDemoOntology, suggestMappings } from '../core/mapping.js';
import { createSchemaRegistry } from '../core/registry.js';
import type { SchemaRegistry } from '../core/registry.js';
import { CoreError } from '../core/types.js';
import type { Clock, IdGenerator, ObservedSchema } from '../core/types.js';

export const MAX_BODY = 8 * 1024 * 1024;

export interface ServerDeps {
  clock?: Clock;
  nextId?: IdGenerator;
  registry?: SchemaRegistry;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, `corpo excede o limite de ${MAX_BODY} bytes`));
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'corpo não é JSON válido');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'corpo deve ser um objeto JSON');
  }
  return parsed as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `campo "${field}" deve ser string não vazia`);
  }
  return value;
}

function asObservedSchema(body: Record<string, unknown>): ObservedSchema {
  const source = asString(body['source'], 'source');
  const object = asString(body['object'], 'object');
  const columns = body['columns'];
  if (!Array.isArray(columns)) {
    throw new HttpError(400, 'campo "columns" deve ser um array');
  }
  return {
    source,
    object,
    columns: columns as ObservedSchema['columns'],
    observedAt: typeof body['observedAt'] === 'string' ? body['observedAt'] : undefined,
  };
}

function statusOf(error: CoreError): number {
  switch (error.code) {
    case 'SCHEMA_NOT_FOUND':
    case 'ALERT_NOT_FOUND':
      return 404;
    case 'SOURCE_PAUSED':
      return 409;
    default:
      return 400;
  }
}

export function createServer(deps: ServerDeps = {}): Server {
  const clock = deps.clock ?? createDeterministicClock();
  const nextId = deps.nextId ?? createIdGenerator();
  const registry = deps.registry ?? createSchemaRegistry({ clock, nextId });

  return createHttpServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;

        if (req.method === 'GET' && path === '/health') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }

        if (req.method === 'GET' && path === '/schemas') {
          const source = url.searchParams.get('source') ?? undefined;
          sendJson(res, 200, { schemas: registry.list(source) });
          return;
        }

        if (req.method === 'GET' && path === '/alerts') {
          const ack = url.searchParams.get('acknowledged');
          sendJson(res, 200, {
            alerts: registry.listAlerts(
              ack === null ? {} : { acknowledged: ack === 'true' },
            ),
          });
          return;
        }

        if (req.method === 'POST' && path === '/schemas/register') {
          const body = await readJson(req);
          const result = registry.register(asObservedSchema(body));
          sendJson(res, 201, result);
          return;
        }

        if (req.method === 'POST' && path === '/schemas/observe') {
          const body = await readJson(req);
          const result = registry.observe(asObservedSchema(body));
          sendJson(res, 200, result);
          return;
        }

        if (req.method === 'POST' && path === '/schemas/resume') {
          const body = await readJson(req);
          const schema = registry.resume(
            asString(body['source'], 'source'),
            asString(body['object'], 'object'),
          );
          sendJson(res, 200, { schema });
          return;
        }

        if (req.method === 'POST' && path === '/discover') {
          const body = await readJson(req);
          const source = asString(body['source'], 'source');
          const object = asString(body['object'], 'object');
          let rows: Record<string, unknown>[];
          if (typeof body['csv'] === 'string') {
            rows = parseCsvSample(body['csv']);
          } else if (Array.isArray(body['rows'])) {
            rows = body['rows'] as Record<string, unknown>[];
          } else {
            throw new HttpError(400, 'informe "rows" (array) ou "csv" (string)');
          }
          const observed = discover({ source, object, rows });
          sendJson(res, 200, { observed });
          return;
        }

        if (req.method === 'POST' && path === '/mappings/suggest') {
          const body = await readJson(req);
          const observed = asObservedSchema(body);
          const suggestions = suggestMappings(observed.columns, createDemoOntology());
          sendJson(res, 200, { suggestions });
          return;
        }

        if (req.method === 'POST' && path === '/alerts/acknowledge') {
          const body = await readJson(req);
          const alert = registry.acknowledgeAlert(asString(body['alertId'], 'alertId'));
          sendJson(res, 200, { alert });
          return;
        }

        sendJson(res, 404, { error: 'rota não encontrada' });
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
        } else if (error instanceof CoreError) {
          sendJson(res, statusOf(error), { error: error.message, code: error.code });
        } else {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
  });
}

export interface StartedServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export function startServer(port = 0, deps: ServerDeps = {}): Promise<StartedServer> {
  const server = createServer(deps);
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const effectivePort =
        typeof address === 'object' && address !== null ? address.port : port;
      resolvePromise({
        server,
        port: effectivePort,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
