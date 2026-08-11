/**
 * tagging-interface-panel — src/server/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: API HTTP DO
 * PAINEL — expõe a tagging interface via node:http puro (GET /health; POST
 * /panel/select; POST /panel/options; POST /panel/tags; GET
 * /panel/tagged-objects; POST /panel/search; POST /panel/sync; POST
 * /panel/export), com limite de corpo de 8 MB, dreno do corpo no 413 e
 * startServer com porta efetiva. Nenhum texto dos claims é reproduzido;
 * apenas a funcionalidade é reimplementada de forma original.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import {
  createDemoInternalDatabase,
  createDemoOntology,
  TaggingInterfacePanel,
} from '../core/panel.js';
import type { ExportDestination, SelectInput } from '../core/panel.js';
import { LoginRequiredError } from '../core/search.js';
import type { Clock, TagOption } from '../core/types.js';
import { createIdGenerator, createStepClock } from '../core/types.js';

/** Tamanho máximo do corpo das requisições (8 MB). */
export const MAX_BODY = 8 * 1024 * 1024;

/** Dependências injetáveis do servidor. */
export interface ServerDeps {
  panel?: TaggingInterfacePanel;
  clock?: Clock;
  user?: string;
  loggedIn?: boolean;
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
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
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
        // Drena o restante do corpo para manter o socket vivo até a resposta 413.
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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
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

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(400, `"${key}" deve ser uma string não vazia`);
  }
  return value;
}

function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new HttpError(400, `"${key}" deve ser um array de strings`);
  }
  return value as string[];
}

const TAG_OPTIONS: readonly TagOption[] = ['property', 'object', 'link'];
const CONTENT_KINDS = ['text', 'image', 'audio', 'video'] as const;
const DESTINATIONS: readonly ExportDestination[] = ['external', 'internal', 'both'];

/** Cria o painel padrão do servidor (ontologia e internal database demo). */
export function createDefaultPanel(deps: ServerDeps = {}): TaggingInterfacePanel {
  return new TaggingInterfacePanel(createDemoOntology(), {
    clock: deps.clock ?? createStepClock('2014-09-18T12:00:00.000Z', 60_000),
    newId: createIdGenerator(),
    user: deps.user ?? 'analista',
    loggedIn: deps.loggedIn ?? true,
    internalDb: createDemoInternalDatabase(),
  });
}

/** Cria o servidor HTTP da tagging interface. */
export function createServer(deps: ServerDeps = {}): Server {
  const panel = deps.panel ?? createDefaultPanel(deps);
  return createHttpServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/health') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }
        if (req.method === 'POST' && req.url === '/panel/select') {
          const body = await readJsonBody(req);
          const contentKind = body['contentKind'] ?? 'text';
          if (
            typeof contentKind !== 'string' ||
            !(CONTENT_KINDS as readonly string[]).includes(contentKind)
          ) {
            throw new HttpError(400, '"contentKind" deve ser text|image|audio|video');
          }
          const input: SelectInput = {
            contentKind: contentKind as SelectInput['contentKind'],
            content: requireString(body, 'content'),
            portion: requireString(body, 'portion'),
          };
          sendJson(res, 200, panel.select(input));
          return;
        }
        if (req.method === 'POST' && req.url === '/panel/options') {
          const body = await readJsonBody(req);
          const option = body['option'];
          if (typeof option !== 'string' || !TAG_OPTIONS.includes(option as TagOption)) {
            throw new HttpError(400, '"option" deve ser property|object|link');
          }
          sendJson(res, 200, { fields: panel.chooseOption(option as TagOption) });
          return;
        }
        if (req.method === 'POST' && req.url === '/panel/tags') {
          const body = await readJsonBody(req);
          const overrides: {
            title?: string;
            type?: string;
            targetObjectIds?: string[];
            targetPropertyIds?: string[];
          } = {};
          const title = body['title'];
          const type = body['type'];
          if (title !== undefined) {
            if (typeof title !== 'string') throw new HttpError(400, '"title" deve ser string');
            overrides.title = title;
          }
          if (type !== undefined) {
            if (typeof type !== 'string') throw new HttpError(400, '"type" deve ser string');
            overrides.type = type;
          }
          const targetObjectIds = optionalStringArray(body, 'targetObjectIds');
          const targetPropertyIds = optionalStringArray(body, 'targetPropertyIds');
          if (targetObjectIds !== undefined) overrides.targetObjectIds = targetObjectIds;
          if (targetPropertyIds !== undefined) overrides.targetPropertyIds = targetPropertyIds;
          sendJson(res, 201, { tag: panel.createTag(overrides) });
          return;
        }
        if (req.method === 'GET' && req.url === '/panel/tagged-objects') {
          sendJson(res, 200, {
            objects: panel.taggedObjects(),
            properties: panel.taggedProperties(),
          });
          return;
        }
        if (req.method === 'POST' && req.url === '/panel/search') {
          const body = await readJsonBody(req);
          sendJson(res, 200, { results: panel.search(requireString(body, 'query')) });
          return;
        }
        if (req.method === 'POST' && req.url === '/panel/sync') {
          const body = await readJsonBody(req);
          const tagged = panel.sync(requireString(body, 'tagId'), requireString(body, 'objectId'));
          sendJson(res, 200, { taggedObject: tagged });
          return;
        }
        if (req.method === 'POST' && req.url === '/panel/export') {
          const body = await readJsonBody(req);
          const destination = body['destination'] ?? 'both';
          if (
            typeof destination !== 'string' ||
            !DESTINATIONS.includes(destination as ExportDestination)
          ) {
            throw new HttpError(400, '"destination" deve ser external|internal|both');
          }
          sendJson(res, 200, { result: panel.export(destination as ExportDestination) });
          return;
        }
        sendJson(res, 404, { error: 'rota não encontrada' });
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
        } else if (error instanceof LoginRequiredError) {
          sendJson(res, 401, { error: error.message });
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
  /** Porta efetiva em que o servidor está ouvindo. */
  port: number;
  close(): Promise<void>;
}

/** Sobe o servidor; com porta 0, a porta efetiva é devolvida em `port`. */
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
