/**
 * cli-script-debugger — src/server/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: DEBUGGER APPLICATION via HTTP —
 * expõe a operação de debug do transformation script (GET /health; POST
 * /debug com config inline: script/ontologia/dados embutidos OU referências a
 * arquivos), reutilizando o núcleo de validação. HTTP puro com node:http,
 * limite de corpo de 8 MB e startServer com porta efetiva.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';

import { parseScript } from '../core/builder.js';
import type { IndicationForm, Ontology, ScriptDefinition } from '../core/types.js';
import { executeDebug } from '../core/runner.js';
import { importCsv, importText } from '../core/validator.js';
import type { AssociationMode } from '../core/validator.js';

/** Tamanho máximo do corpo das requisições (8 MB). */
export const MAX_BODY = 8 * 1024 * 1024;

/** Corpo do POST /debug: config inline com conteúdo embutido ou referências. */
export interface InlineDebugRequest {
  script?: ScriptDefinition;
  scriptFile?: string;
  ontology?: Ontology;
  ontologyFile?: string;
  data?: string;
  dataFile?: string;
  dataFormat?: 'csv' | 'text';
  mode?: AssociationMode;
  form?: IndicationForm;
}

export interface ServerDeps {
  readFile?: (path: string) => string;
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

async function handleDebug(
  req: IncomingMessage,
  res: ServerResponse,
  readFile: (path: string) => string,
): Promise<void> {
  const body = await readBody(req);
  let parsed: InlineDebugRequest;
  try {
    parsed = JSON.parse(body) as InlineDebugRequest;
  } catch {
    throw new HttpError(400, 'corpo não é JSON válido');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new HttpError(400, 'corpo deve ser um objeto JSON');
  }
  const dataFormat = parsed.dataFormat ?? 'csv';
  if (dataFormat !== 'csv' && dataFormat !== 'text') {
    throw new HttpError(400, '"dataFormat" deve ser "csv" ou "text"');
  }
  const mode = parsed.mode ?? 'eager';
  if (mode !== 'eager' && mode !== 'lazy') {
    throw new HttpError(400, '"mode" deve ser "eager" ou "lazy"');
  }

  // Script: embutido ou referência a arquivo.
  let script: ScriptDefinition;
  if (parsed.script !== undefined) {
    script = parseScript(JSON.stringify(parsed.script));
  } else if (parsed.scriptFile !== undefined) {
    script = parseScript(readFile(parsed.scriptFile));
  } else {
    throw new HttpError(400, 'informe "script" (embutido) ou "scriptFile" (referência)');
  }

  // Ontologia: embutida ou referência; no modo lazy o loader adia a leitura.
  let ontologyText: string | undefined;
  if (parsed.ontology !== undefined) ontologyText = JSON.stringify(parsed.ontology);
  const loadOntology = (): string => {
    if (ontologyText !== undefined) return ontologyText;
    if (parsed.ontologyFile !== undefined) return readFile(parsed.ontologyFile);
    throw new HttpError(400, 'informe "ontology" (embutida) ou "ontologyFile" (referência)');
  };

  // Dados: embutidos ou referência a arquivo.
  let dataText: string;
  if (parsed.data !== undefined) {
    dataText = parsed.data;
  } else if (parsed.dataFile !== undefined) {
    dataText = readFile(parsed.dataFile);
  } else {
    throw new HttpError(400, 'informe "data" (embutido) ou "dataFile" (referência)');
  }

  const items = dataFormat === 'csv' ? importCsv(dataText) : importText(dataText);
  const { verdict, indication } = executeDebug(
    script,
    items,
    { mode, indication: { form: parsed.form ?? 'message' } },
    { loadOntology, sinks: [] },
  );
  sendJson(res, 200, { verdict, indication });
}

/** Cria o servidor HTTP da debugger application. */
export function createServer(deps: ServerDeps = {}): Server {
  const readFile = deps.readFile ?? ((p: string): string => readFileSync(p, 'utf8'));
  return createHttpServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/health') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }
        if (req.method === 'POST' && req.url === '/debug') {
          await handleDebug(req, res, readFile);
          return;
        }
        sendJson(res, 404, { error: 'rota não encontrada' });
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
