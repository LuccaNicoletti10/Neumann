/**
 * inline-tag-sync — src/server/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * SERVIDOR HTTP DAS PLATAFORMAS — expõe o fluxo completo: criação de
 * documentos, in-line tagging (first tags e atalho "@"), busca de objetos,
 * geração do data object, object-based tagging (second tags) e re-edição sem
 * deslocamento (reload/finalize) com sincronização entre plataformas. HTTP
 * puro com node:http, limite de corpo de 8 MB e startServer com porta efetiva.
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { generateDataObject, generateObjectView } from '../core/dataObject.js';
import { createDocument, isDocumentFieldId } from '../core/document.js';
import { createObjectStore } from '../core/objectStore.js';
import type { ObjectStore } from '../core/objectStore.js';
import {
  applySecondTag,
  editSessionField,
  reloadDocumentForEditing,
  synchronizeEdits,
} from '../core/sync.js';
import type { SyncDeps } from '../core/sync.js';
import { applyFirstTag, applyTagShortcut } from '../core/tagging.js';
import type {
  Clock,
  Document,
  DocumentFieldId,
  IdGenerator,
} from '../core/types.js';
import { createIdGenerator } from '../core/types.js';

/** Tamanho máximo do corpo das requisições (8 MB). */
export const MAX_BODY = 8 * 1024 * 1024;

export interface ServerDeps {
  clock?: Clock;
  /** Semeia o object store (segunda plataforma) antes de servir. */
  seed?: (store: ObjectStore) => void;
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

type JsonObject = Record<string, unknown>;

async function readJsonObject(req: IncomingMessage): Promise<JsonObject> {
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
  return parsed as JsonObject;
}

function requireString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `"${key}" é obrigatório e deve ser string não vazia`);
  }
  return value;
}

function optionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, `"${key}" deve ser string`);
  }
  return value;
}

function requireInt(body: JsonObject, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new HttpError(400, `"${key}" é obrigatório e deve ser inteiro`);
  }
  return value;
}

function requireField(body: JsonObject): DocumentFieldId {
  const value = requireString(body, 'field');
  if (!isDocumentFieldId(value)) {
    throw new HttpError(400, '"field" deve ser "title", "summary" ou "note"');
  }
  return value;
}

interface RangeBody {
  field: DocumentFieldId;
  start: number;
  end: number;
}

function requireRange(body: JsonObject): RangeBody {
  return {
    field: requireField(body),
    start: requireInt(body, 'start'),
    end: requireInt(body, 'end'),
  };
}

/** Dependências de determinismo compartilhadas pelas rotas. */
interface ServerCoreDeps extends SyncDeps {
  newDocumentId?: IdGenerator;
}

/** Estado compartilhado das duas plataformas atendidas pelo servidor. */
interface PlatformState {
  store: ObjectStore;
  documents: Map<string, Document>;
  syncDeps: ServerCoreDeps;
}

function getDocument(state: PlatformState, body: JsonObject): Document {
  const documentId = requireString(body, 'documentId');
  const doc = state.documents.get(documentId);
  if (doc === undefined) {
    throw new HttpError(404, `documento não encontrado: "${documentId}"`);
  }
  return doc;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  state: PlatformState,
): Promise<void> {
  const { method, url } = req;
  if (method === 'GET' && url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (method !== 'POST') {
    sendJson(res, 404, { error: 'rota não encontrada' });
    return;
  }

  switch (url) {
    case '/documents': {
      const body = await readJsonObject(req);
      const doc = createDocument(
        {
          id: optionalString(body, 'id'),
          title: optionalString(body, 'title'),
          summary: optionalString(body, 'summary'),
          note: optionalString(body, 'note'),
          userId: optionalString(body, 'userId'),
        },
        state.syncDeps,
      );
      state.documents.set(doc.id, doc);
      sendJson(res, 201, { document: doc });
      return;
    }
    case '/objects': {
      const body = await readJsonObject(req);
      const type = requireString(body, 'type');
      const rawProps = body['properties'];
      if (
        rawProps !== undefined &&
        (typeof rawProps !== 'object' || rawProps === null || Array.isArray(rawProps))
      ) {
        throw new HttpError(400, '"properties" deve ser um objeto de strings');
      }
      const properties: Record<string, string> = {};
      for (const [key, value] of Object.entries((rawProps ?? {}) as JsonObject)) {
        if (typeof value !== 'string') {
          throw new HttpError(400, `"properties.${key}" deve ser string`);
        }
        properties[key] = value;
      }
      const object = state.store.createObject({
        id: optionalString(body, 'id'),
        type,
        properties,
        createdBy: optionalString(body, 'userId'),
      });
      sendJson(res, 201, { object });
      return;
    }
    case '/objects/search': {
      const body = await readJsonObject(req);
      const text = requireString(body, 'text');
      sendJson(res, 200, { results: state.store.searchObjects(text) });
      return;
    }
    case '/tags/first': {
      const body = await readJsonObject(req);
      const doc = getDocument(state, body);
      const range = requireRange(body);
      const tag = applyFirstTag(
        doc,
        {
          ...range,
          objectId: requireString(body, 'objectId'),
          propertyKey: requireString(body, 'propertyKey'),
          userId: optionalString(body, 'userId'),
        },
        state.store,
        state.syncDeps,
      );
      sendJson(res, 201, { tag });
      return;
    }
    case '/tags/shortcut': {
      const body = await readJsonObject(req);
      const doc = getDocument(state, body);
      const result = applyTagShortcut(
        doc,
        requireField(body),
        {
          objectId: requireString(body, 'objectId'),
          propertyKey: requireString(body, 'propertyKey'),
          userId: optionalString(body, 'userId'),
        },
        state.store,
        state.syncDeps,
      );
      sendJson(res, 201, result);
      return;
    }
    case '/data-objects/generate': {
      const body = await readJsonObject(req);
      const doc = getDocument(state, body);
      const dataObject = generateDataObject(doc, state.store, state.syncDeps);
      const view = generateObjectView(doc, state.store, state.syncDeps);
      sendJson(res, 201, { dataObject, view });
      return;
    }
    case '/tags/second': {
      const body = await readJsonObject(req);
      const doc = getDocument(state, body);
      const range = requireRange(body);
      const result = applySecondTag(
        doc,
        {
          ...range,
          objectId: requireString(body, 'objectId'),
          propertyKey: requireString(body, 'propertyKey'),
          userId: optionalString(body, 'userId'),
        },
        state.store,
        state.syncDeps,
      );
      sendJson(res, 201, result);
      return;
    }
    case '/sync/reload': {
      const body = await readJsonObject(req);
      const dataObjectId = requireString(body, 'dataObjectId');
      const session = reloadDocumentForEditing(dataObjectId, state.store, state.syncDeps);
      sendJson(res, 200, { session });
      return;
    }
    case '/sync/finalize': {
      const body = await readJsonObject(req);
      const dataObjectId = requireString(body, 'dataObjectId');
      const userId = optionalString(body, 'userId') ?? 'system';
      const session = reloadDocumentForEditing(dataObjectId, state.store, state.syncDeps);
      const rawFields = body['fields'];
      if (rawFields !== undefined) {
        if (typeof rawFields !== 'object' || rawFields === null || Array.isArray(rawFields)) {
          throw new HttpError(400, '"fields" deve ser um objeto com campos do documento');
        }
        for (const [fieldId, text] of Object.entries(rawFields as JsonObject)) {
          if (!isDocumentFieldId(fieldId)) {
            throw new HttpError(400, `campo desconhecido em "fields": "${fieldId}"`);
          }
          if (typeof text !== 'string') {
            throw new HttpError(400, `"fields.${fieldId}" deve ser string`);
          }
          editSessionField(session, fieldId, text, userId, state.syncDeps);
        }
      }
      const result = synchronizeEdits(session, state.store, state.syncDeps);
      state.documents.set(result.document.id, result.document);
      sendJson(res, 200, result);
      return;
    }
    default:
      sendJson(res, 404, { error: 'rota não encontrada' });
  }
}

/** Cria o servidor HTTP das duas plataformas (documento + object store). */
export function createServer(deps: ServerDeps = {}): Server {
  const store = createObjectStore({ clock: deps.clock });
  deps.seed?.(store);
  const state: PlatformState = {
    store,
    documents: new Map<string, Document>(),
    syncDeps: {
      clock: deps.clock,
      newDocumentId: createIdGenerator('doc'),
      newTagId: createIdGenerator('tag'),
      newRevisionId: createIdGenerator('rev'),
      newDataObjectId: createIdGenerator('dobj'),
      newCommentId: createIdGenerator('cmt'),
    },
  };
  return createHttpServer((req, res) => {
    void (async () => {
      try {
        await route(req, res, state);
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
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
