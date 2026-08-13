/**
 * event-bus — HTTP writeback idempotency after crash-before-DELIVERED.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import { createPgOutboxRepository } from '../src/store/pg-outbox-repository.js';
import { createOutboxWorker } from '../src/worker/outbox-worker.js';
import { createHttpWritebackConnector } from '../src/writeback/http.js';
import { createWritebackHandler } from '../src/writeback/handler.js';
import { createPgWritebackExecutionStore } from '../src/writeback/executions.js';

const db = await tryOpenIsolatedPg();

function startFakeErp(): Promise<{ url: string; close: () => Promise<void>; stats: () => { posts: number } }> {
  const idem = new Map<string, { status: number; body: string }>();
  let posts = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const key = String(req.headers['idempotency-key'] ?? '');
      if (key && idem.has(key) && req.method !== 'GET') {
        const cached = idem.get(key)!;
        res.writeHead(cached.status, { 'content-type': 'application/json' });
        res.end(cached.body);
        return;
      }
      posts += 1;
      const body = JSON.stringify({ id: 'O1', status: 'ok', posts });
      if (key) idem.set(key, { status: 200, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        stats: () => ({ posts }),
        close: () =>
          new Promise((r, j) => server.close((err) => (err ? j(err) : r()))),
      });
    });
  });
}

describe.skipIf(!db)('HTTP writeback idempotency', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('retry after crash-before-DELIVERED hits ERP once via Idempotency-Key', async () => {
    if (!db) return;
    const erp = await startFakeErp();
    try {
      const repo = createPgOutboxRepository({ sql: db.sql });
      const eventId = randomUUID();
      await repo.insert({
        eventId,
        topic: 'action.side_effect.writeback',
        key: 'http',
        payload: { connectorId: 'erp', operation: 'update', params: { orderId: 'O1', status: 'ok' } },
        principal: 'u1',
        traceId: eventId,
      });

      const executions = createPgWritebackExecutionStore({ sql: db.sql });
      const connector = createHttpWritebackConnector({ baseUrl: erp.url });
      let crashOnce = true;
      const worker = createOutboxWorker({
        sql: db.sql,
        maxAttempts: 5,
        backoff: { random: () => 0.5, schedule: [0] },
        onError: () => {},
        handlers: {
          'action.side_effect.writeback': async (ev) => {
            await createWritebackHandler({ connector, executions })(ev);
            if (crashOnce) {
              crashOnce = false;
              throw new Error('crash after HTTP success before DELIVERED');
            }
          },
        },
      });

      await worker.drainOnce();
      const mid = await db.sql.query<{ status: string }>(
        `SELECT status FROM outbox_events WHERE event_id = $1`,
        [eventId],
      );
      expect(mid.rows[0]?.status).toBe('RETRYING');

      await worker.drainOnce();
      const done = await db.sql.query<{ status: string }>(
        `SELECT status FROM outbox_events WHERE event_id = $1`,
        [eventId],
      );
      expect(done.rows[0]?.status).toBe('DELIVERED');
      expect(erp.stats().posts).toBe(1);
      const trail = await executions.listByEvent(eventId);
      expect(trail.length).toBeGreaterThanOrEqual(2);
    } finally {
      await erp.close();
    }
  });
});
