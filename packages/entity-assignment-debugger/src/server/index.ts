/**
 * entity-assignment-debugger — servidor HTTP (node:http puro, sem dependências).
 *
 * Expõe a operação de depuração e a consulta de consistência da ontologia
 * (componentes da patente US 9,984,152 B2 implementados em src/core):
 *   GET  /health           → { status: 'ok' }
 *   POST /debug            → { script, ontology, dataSource } → DebugReport + mensagens exibidas
 *   POST /ontology/check   → { script, ontology } → consistência atribuição×definição e de links
 * Corpo máximo: MAX_BODY (8 MB). startServer retorna a porta efetiva.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dataSourceFromDescriptor, type DataSourceDescriptor } from '../core/data-source.js';
import { MemoryDisplayDevice, ScriptDebugger } from '../core/debugger.js';
import { Ontology, type OntologyJSON } from '../core/ontology.js';
import type { TransformationScript } from '../core/types.js';

export const MAX_BODY = 8 * 1024 * 1024; // 8 MB

export interface StartedServer {
  server: Server;
  port: number;
}

interface DebugRequestBody {
  script: TransformationScript;
  ontology: OntologyJSON;
  dataSource: DataSourceDescriptor;
}

interface CheckRequestBody {
  script: TransformationScript;
  ontology: OntologyJSON;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new BodyTooLargeError());
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

class BodyTooLargeError extends Error {
  constructor() {
    super('corpo da requisição excede o limite de 8 MB');
  }
}

function parseJsonBody<T>(raw: string): T {
  if (raw.length === 0) throw new Error('corpo JSON vazio');
  return JSON.parse(raw) as T;
}

function assertScript(script: TransformationScript | undefined): asserts script is TransformationScript {
  if (!script || !Array.isArray(script.definitions) || !Array.isArray(script.conditions)) {
    throw new Error('"script" inválido: esperado { definitions: [], conditions: [], ... }');
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (method === 'POST' && url === '/debug') {
    const body = parseJsonBody<DebugRequestBody>(await readBody(req));
    assertScript(body.script);
    if (!body.dataSource) throw new Error('"dataSource" é obrigatório');
    const ontology = Ontology.fromJSON(body.ontology);
    const source = dataSourceFromDescriptor(body.dataSource);
    const display = new MemoryDisplayDevice();
    const report = new ScriptDebugger(display).run(body.script, ontology, source);
    sendJson(res, 200, { ...report, displayed: display.messages });
    return;
  }

  if (method === 'POST' && url === '/ontology/check') {
    const body = parseJsonBody<CheckRequestBody>(await readBody(req));
    assertScript(body.script);
    const ontology = Ontology.fromJSON(body.ontology);
    const entities = body.script.definitions.map((def) => ({
      entity: def.name,
      ...ontology.isConsistentWith(def),
    }));
    const links = body.script.links.map((link) => ({
      link: link.name,
      ...ontology.isLinkConsistent(link),
    }));
    sendJson(res, 200, {
      consistent: entities.every((e) => e.consistent) && links.every((l) => l.consistent),
      entities,
      links,
    });
    return;
  }

  sendJson(res, 404, { error: 'rota não encontrada' });
}

/** Cria e inicia o servidor; resolve com a porta efetiva (0 = porta aleatória). */
export function startServer(port = 0, host = '127.0.0.1'): Promise<StartedServer> {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      if (err instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: err.message });
      } else if (err instanceof SyntaxError || err instanceof Error) {
        sendJson(res, 400, { error: `requisição inválida: ${err.message}` });
      } else {
        sendJson(res, 500, { error: 'erro interno' });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const effectivePort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({ server, port: effectivePort });
    });
  });
}
