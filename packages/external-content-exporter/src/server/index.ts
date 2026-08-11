/**
 * external-content-exporter — src/server/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: SERVIDOR HTTP DA TAGGING
 * INTERFACE — expõe o fluxo completo (GET /health; POST /login e /logout;
 * POST /bookmarklets; POST /sessions para ativar o bookmarklet e melhorar o
 * browser; POST /sessions/:id/tags para receber a tag criada; POST /export e
 * /export/flush para exportar ao internal database system, com 401 sem
 * sessão). HTTP puro com node:http, limite de corpo de 8 MB com dreno no 413 e
 * startServer com porta efetiva. Nenhum texto dos claims é reproduzido; apenas
 * a funcionalidade é reimplementada de forma original.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { createAuth } from '../core/auth.js';
import type { AuthService } from '../core/auth.js';
import { activate, createBookmarklet } from '../core/bookmarklet.js';
import type { Bookmarklet } from '../core/bookmarklet.js';
import {
  accessExternalContent,
  createWebBrowser,
  enhanceLocalCopy,
  labelContent,
} from '../core/content.js';
import type { ExternalTransport } from '../core/content.js';
import { createDeterministicClock, createIdGenerator } from '../core/determinism.js';
import { createExporter } from '../core/exporter.js';
import type { Exporter } from '../core/exporter.js';
import { createInternalDb } from '../core/internalDb.js';
import type { InternalDatabase } from '../core/internalDb.js';
import { createTaggingSession } from '../core/tagging.js';
import type { TaggingSession } from '../core/tagging.js';
import { createTagStore } from '../core/tagStore.js';
import type { TagStore } from '../core/tagStore.js';
import { CoreError } from '../core/types.js';
import type { Clock, IdGenerator } from '../core/types.js';

/** Tamanho máximo do corpo das requisições (8 MB). */
export const MAX_BODY = 8 * 1024 * 1024;

/** Dependências injetáveis do servidor (determinismo + núcleo). */
export interface ServerDeps {
  clock?: Clock;
  nextId?: IdGenerator;
  transport?: ExternalTransport;
  autoExportOnCreate?: boolean;
  auth?: AuthService;
  tagStore?: TagStore;
  internalDb?: InternalDatabase;
}

/** Estado completo da aplicação (reutilizado por servidor e testes). */
export interface AppState {
  clock: Clock;
  nextId: IdGenerator;
  auth: AuthService;
  tagStore: TagStore;
  internalDb: InternalDatabase;
  exporter: Exporter;
  bookmarklets: Map<string, Bookmarklet>;
  taggingSessions: Map<string, TaggingSession>;
}

/** Monta o estado da aplicação com defaults determinísticos compartilhados. */
export function createAppState(deps: ServerDeps = {}): AppState {
  const clock = deps.clock ?? createDeterministicClock();
  const nextId = deps.nextId ?? createIdGenerator();
  const auth = deps.auth ?? createAuth({ clock, nextId });
  const tagStore = deps.tagStore ?? createTagStore();
  const internalDb = deps.internalDb ?? createInternalDb({ nextId });
  const exporter = createExporter({
    auth,
    tagStore,
    internalDb,
    clock,
    autoExportOnCreate: deps.autoExportOnCreate,
  });
  return {
    clock,
    nextId,
    auth,
    tagStore,
    internalDb,
    exporter,
    bookmarklets: new Map<string, Bookmarklet>(),
    taggingSessions: new Map<string, TaggingSession>(),
  };
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

/** Token da sessão: header x-session-token tem precedência sobre o corpo. */
function tokenFrom(req: IncomingMessage, body: Record<string, unknown>): string | undefined {
  const header = req.headers['x-session-token'];
  if (typeof header === 'string' && header !== '') return header;
  return typeof body['token'] === 'string' ? (body['token'] as string) : undefined;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  state: AppState,
  transport: ExternalTransport | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'POST' && path === '/login') {
    const body = await readJson(req);
    const session = state.auth.login(asString(body['user'], 'user'), asString(body['password'], 'password'));
    sendJson(res, 200, session);
    return;
  }

  if (req.method === 'POST' && path === '/logout') {
    const body = await readJson(req);
    const token = tokenFrom(req, body);
    if (token === undefined) throw new HttpError(400, 'informe o token (header ou corpo)');
    sendJson(res, 200, { loggedOut: state.auth.logout(token) });
    return;
  }

  if (req.method === 'POST' && path === '/bookmarklets') {
    const body = await readJson(req);
    const name = asString(body['name'], 'name');
    const commands = body['commands'];
    if (!Array.isArray(commands) || commands.some((c) => typeof c !== 'string')) {
      throw new HttpError(400, 'campo "commands" deve ser um array de strings');
    }
    const bookmarklet = createBookmarklet(name, commands as string[], { nextId: state.nextId });
    state.bookmarklets.set(bookmarklet.id, bookmarklet);
    sendJson(res, 201, bookmarklet);
    return;
  }

  // Ativação do bookmarklet: melhora o browser e abre a tagging interface.
  if (req.method === 'POST' && path === '/sessions') {
    const body = await readJson(req);
    const bookmarkletId = asString(body['bookmarkletId'], 'bookmarkletId');
    const bookmarklet = state.bookmarklets.get(bookmarkletId);
    if (bookmarklet === undefined) {
      throw new HttpError(404, `bookmarklet não encontrado: ${bookmarkletId}`);
    }
    const contentUrl = asString(body['url'], 'url');
    const activation = activate(bookmarklet);
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, contentUrl, {
      transport,
      nextId: state.nextId,
    });
    const enhanced = enhanceLocalCopy(content, activation.commands);
    labelContent(enhanced.content, state.tagStore.contentCache);
    const token = tokenFrom(req, body);
    const user = token === undefined ? 'anonymous' : state.auth.requireSession(token).user;
    const session = createTaggingSession(enhanced.content, {
      clock: state.clock,
      nextId: state.nextId,
      user,
    });
    state.taggingSessions.set(session.id, session);
    sendJson(res, 201, {
      sessionId: session.id,
      contentLabel: session.contentLabel,
      enhanced: enhanced.enhanced,
      injectedMarkup: enhanced.injectedMarkup,
      taggingInterfaceVisible: activation.taggingInterfaceVisible,
    });
    return;
  }

  // A tagging interface recebe a tag criada sobre a porção selecionada.
  const tagMatch = /^\/sessions\/([^/]+)\/tags$/.exec(path);
  if (req.method === 'POST' && tagMatch !== null) {
    const sessionId = tagMatch[1] ?? '';
    const session = state.taggingSessions.get(sessionId);
    if (session === undefined) {
      throw new HttpError(404, `sessão de tagging não encontrada: ${sessionId}`);
    }
    const body = await readJson(req);
    const selection = body['selection'];
    const tag = session.createTag(
      {
        tagOption: asString(body['tagOption'], 'tagOption') as 'object' | 'property' | 'link',
        title: asString(body['title'], 'title'),
        type: asString(body['type'], 'type'),
      },
      selection === undefined
        ? undefined
        : (selection as Parameters<TaggingSession['createTag']>[1]),
    );
    const receipt = state.exporter.receiveTag(tag);
    sendJson(res, 201, { tag, autoExported: receipt !== undefined, receipt });
    return;
  }

  // Botão "Export to Internal DB" (EXIGE login → 401 sem sessão).
  if (req.method === 'POST' && path === '/export') {
    const body = await readJson(req);
    const receipt = state.exporter.exportTag(tokenFrom(req, body), asString(body['tagId'], 'tagId'), {
      retainExternal: body['retainExternal'] === true,
    });
    sendJson(res, 200, receipt);
    return;
  }

  // Flush da fila pendente (device conectou/logou depois).
  if (req.method === 'POST' && path === '/export/flush') {
    const body = await readJson(req);
    const receipts = state.exporter.flushPending(tokenFrom(req, body), {
      retainExternal: body['retainExternal'] === true,
    });
    sendJson(res, 200, { exported: receipts.length, receipts });
    return;
  }

  sendJson(res, 404, { error: 'rota não encontrada' });
}

/** Mapeia erros do núcleo para status HTTP. */
function statusOf(error: CoreError): number {
  switch (error.code) {
    case 'LOGIN_REQUIRED':
    case 'INVALID_CREDENTIALS':
      return 401;
    case 'TAG_NOT_FOUND':
    case 'CONTENT_NOT_FOUND':
      return 404;
    default:
      return 400;
  }
}

/** Cria o servidor HTTP da tagging interface. */
export function createServer(deps: ServerDeps = {}): Server {
  const state = createAppState(deps);
  return createHttpServer((req, res) => {
    void (async () => {
      try {
        await route(req, res, state, deps.transport);
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
