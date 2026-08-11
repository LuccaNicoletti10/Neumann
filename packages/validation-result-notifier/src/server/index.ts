/**
 * validation-result-notifier — src/server/index.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: camada HTTP (node:http puro, sem deps) expondo o núcleo
 * de validação proativa e a entrega de indicações expressed — POST /validate
 * recebe { script, dataSource, notify:{channel, form} } e responde vereditos,
 * resultados (implicit/expressed) e as indicações efetivamente entregues.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CHANNEL_NAMES, createDefaultChannels, type ChannelName, type DeliveredIndication } from '../core/channels.js';
import { ValidationNotifier, type NotifyRunOutput } from '../core/notifier.js';
import { RENDER_FORMS, type RenderForm } from '../core/renderers.js';
import type { ValidationResult } from '../core/results.js';
import type { DataSourceSpec, TransformationScript } from '../core/types.js';
import { importDataItems } from '../core/validation.js';

export const MAX_BODY = 8 * 1024 * 1024; // 8 MB

export { CHANNEL_NAMES };

export interface ValidateRequestBody {
  script: TransformationScript;
  dataSource: DataSourceSpec;
  notify?: {
    channel?: ChannelName;
    form?: RenderForm;
  };
}

export interface ValidateResponseBody {
  results: ValidationResult[];
  delivered: DeliveredIndication[];
  captured: {
    debugger: number;
    email: number;
    popup: number;
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return; // drena o restante sem acumular
      total += chunk.length;
      if (total > MAX_BODY) {
        tooLarge = true;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => reject(err));
  });
}

class BodyTooLargeError extends Error {
  constructor() {
    super('corpo excede o limite de 8 MB');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validação estrutural mínima do corpo de /validate. */
export function parseValidateBody(raw: unknown): ValidateRequestBody {
  if (!isRecord(raw)) throw new Error('corpo deve ser um objeto JSON');
  const script = raw['script'];
  const dataSource = raw['dataSource'];
  if (!isRecord(script) || !Array.isArray(script['conditions']) || !Array.isArray(script['entities'])) {
    throw new Error("campo 'script' inválido: esperado { name, entities, ontologyParameters, conditions }");
  }
  if (!Array.isArray(script['ontologyParameters'])) {
    script['ontologyParameters'] = [];
  }
  if (typeof script['name'] !== 'string') {
    script['name'] = 'script-remoto';
  }
  if (!isRecord(dataSource) || !['csv', 'json', 'text'].includes(String(dataSource['format'])) || typeof dataSource['content'] !== 'string') {
    throw new Error("campo 'dataSource' inválido: esperado { format: 'csv'|'json'|'text', content }");
  }
  const notify = raw['notify'];
  if (notify !== undefined) {
    if (!isRecord(notify)) throw new Error("campo 'notify' inválido");
    const channel = notify['channel'];
    const form = notify['form'];
    if (channel !== undefined && !CHANNEL_NAMES.includes(channel as ChannelName)) {
      throw new Error(`canal desconhecido: ${String(channel)}`);
    }
    if (form !== undefined && !RENDER_FORMS.includes(form as RenderForm)) {
      throw new Error(`forma desconhecida: ${String(form)}`);
    }
  }
  return raw as unknown as ValidateRequestBody;
}

/** Executa a validação + notificação usando canais padrão com fakes capturáveis. */
export function executeValidate(body: ValidateRequestBody): ValidateResponseBody {
  const defaults = createDefaultChannels();
  const notifier = new ValidationNotifier(defaults.channels);
  const dataItems = importDataItems(body.dataSource);
  const output: NotifyRunOutput = notifier.run({
    script: body.script,
    dataItems,
    notify: {
      ...(body.notify?.channel !== undefined ? { channel: body.notify.channel } : {}),
      ...(body.notify?.form !== undefined ? { form: body.notify.form } : {}),
    },
  });
  return {
    results: output.results,
    delivered: output.delivered,
    captured: {
      debugger: defaults.debuggerSink.delivered.length,
      email: defaults.mailSender.sent.length,
      popup: defaults.popupSink.shown.length,
    },
  };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  if (url.pathname === '/health') {
    if (method !== 'GET') return sendJson(res, 405, { error: 'método não permitido' });
    return sendJson(res, 200, { status: 'ok', service: 'validation-result-notifier' });
  }

  if (url.pathname === '/channels') {
    if (method !== 'GET') return sendJson(res, 405, { error: 'método não permitido' });
    return sendJson(res, 200, {
      channels: CHANNEL_NAMES,
      forms: RENDER_FORMS,
      maxBody: MAX_BODY,
    });
  }

  if (url.pathname === '/validate') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'método não permitido' });
    let raw: Buffer;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return sendJson(res, 413, { error: err.message, maxBody: MAX_BODY });
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendJson(res, 400, { error: 'JSON inválido' });
    }
    let body: ValidateRequestBody;
    try {
      body = parseValidateBody(parsed);
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    try {
      return sendJson(res, 200, executeValidate(body));
    } catch (err) {
      return sendJson(res, 422, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return sendJson(res, 404, { error: 'rota não encontrada' });
}

export interface RunningServer {
  server: Server;
  /** Porta efetiva após o bind (resolve porta 0). */
  port: number;
  close(): Promise<void>;
}

/** Sobe o servidor HTTP; porta 0 → porta efêmera, retornada como porta efetiva. */
export function startServer(port = 0): Promise<RunningServer> {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const effectivePort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        server,
        port: effectivePort,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
