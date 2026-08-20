import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { InMemoryTransactionalStore } from '../store/memory-outbox.js';
import { OutboxPublisher } from '../publisher.js';
import { IdempotentConsumer } from '../consumer.js';
import { withOutbox } from '../with-outbox.js';

export interface DemoServerOptions {
  port?: number;
  store?: InMemoryTransactionalStore;
}

export interface DemoServerHandle {
  port: number;
  store: InMemoryTransactionalStore;
  consumer: IdempotentConsumer;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startDemoServer(options: DemoServerOptions = {}): Promise<DemoServerHandle> {
  const store = options.store ?? new InMemoryTransactionalStore();
  const consumer = new IdempotentConsumer();
  const delivered: string[] = [];

  const publisher = new OutboxPublisher(store, async (record) => {
    await consumer.handle(record, () => {
      delivered.push(record.eventId);
    });
  });

  publisher.start();

  const server = createServer((req, res) => {
    void (async () => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, delivered: delivered.length }));
        return;
      }

      if (req.method === 'POST' && req.url === '/events') {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as {
          topic?: string;
          key?: string;
          payload?: Record<string, unknown>;
          principal?: string;
          tenantId?: string;
          traceId?: string;
        };

        await withOutbox(store, async (tx) => {
          tx.writeBusiness('events', {
            topic: body.topic ?? 'default',
            key: body.key ?? 'unknown+0',
          });
          tx.insertOutbox({
            topic: body.topic ?? 'default',
            key: body.key ?? 'unknown+0',
            payload: body.payload ?? {},
            principal: body.principal ?? 'anonymous',
            tenantId: body.tenantId ?? 'default',
            traceId: body.traceId ?? randomUUID(),
          });
        });

        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));
        return;
      }

      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    })();
  });

  const port = options.port ?? 0;
  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: boundPort,
    store,
    consumer,
    close: async () => {
      publisher.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export function createHealthHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  };
}
