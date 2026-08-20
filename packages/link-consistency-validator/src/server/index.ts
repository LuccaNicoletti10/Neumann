/**
 * link-consistency-validator — servidor HTTP (somente node:http).
 *
 * Expõe a operação de depuração da patente US 8,930,897 B2 via HTTP:
 *   GET  /health     → { "status": "ok" }
 *   POST /validate   → { script, ontology, dataSource } → sequência de resultados
 *   POST /parse-dsl  → { script } → script parseado (ou erro de sintaxe c/ linha)
 * Limite de corpo: MAX_BODY (8 MB).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ScriptBuilder } from '../core/builder.js';
import { DslSyntaxError } from '../core/dsl.js';
import { importDataItems, type DataSourceConfig } from '../core/data-source.js';
import { Ontology, type OntologyJson } from '../core/ontology.js';
import { CollectingDisplayDevice } from '../core/types.js';
import { ScriptValidator } from '../core/validator.js';

export const MAX_BODY = 8 * 1024 * 1024; // 8 MB

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true; // descarta o restante, mas drena o corpo p/ responder 413
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', reject);
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('INVALID_JSON');
  }
}

export interface ValidateRequestBody {
  script: string;
  ontology: string | OntologyJson;
  dataSource: DataSourceConfig;
}

export function createApp(): Server {
  return createServer((req, res) => {
    void (async () => {
    try {
      const { method, url } = req;
      if (method === 'GET' && url === '/health') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }
      if (method === 'POST' && url === '/parse-dsl') {
        const body = (await parseJsonBody(req)) as { script?: unknown };
        if (typeof body.script !== 'string') {
          sendJson(res, 400, { error: 'campo "script" (string) é obrigatório' });
          return;
        }
        try {
          const builder = ScriptBuilder.fromDsl(body.script);
          sendJson(res, 200, { entities: builder.entities, links: builder.links, conditions: builder.conditions });
        } catch (err) {
          if (err instanceof DslSyntaxError) {
            sendJson(res, 422, { error: err.message, line: err.line });
          } else {
            sendJson(res, 422, { error: (err as Error).message });
          }
        }
        return;
      }
      if (method === 'POST' && url === '/validate') {
        const body = (await parseJsonBody(req)) as Partial<ValidateRequestBody>;
        if (typeof body.script !== 'string' || body.ontology === undefined || body.dataSource === undefined) {
          sendJson(res, 400, { error: 'campos "script", "ontology" e "dataSource" são obrigatórios' });
          return;
        }
        try {
          const builder = ScriptBuilder.fromDsl(body.script);
          const ontology = Ontology.fromJson(body.ontology);
          const items = importDataItems(body.dataSource);
          const display = new CollectingDisplayDevice();
          const results = new ScriptValidator(ontology, display).debug(builder, items);
          sendJson(res, 200, { results, displayed: display.messages });
        } catch (err) {
          sendJson(res, 422, { error: (err as Error).message });
        }
        return;
      }
      sendJson(res, 404, { error: 'rota não encontrada' });
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: `corpo excede o limite de ${MAX_BODY} bytes` });
      } else if (message === 'INVALID_JSON') {
        sendJson(res, 400, { error: 'corpo da requisição não é JSON válido' });
      } else {
        sendJson(res, 500, { error: 'erro interno do servidor' });
      }
    }
    })();
  });
}

export interface RunningServer {
  server: Server;
  /** Porta efetiva em que o servidor está escutando. */
  port: number;
  host: string;
  close(): Promise<void>;
}

export function startServer(port = 0, host = '127.0.0.1'): Promise<RunningServer> {
  const server = createApp();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const effectivePort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        server,
        port: effectivePort,
        host,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
