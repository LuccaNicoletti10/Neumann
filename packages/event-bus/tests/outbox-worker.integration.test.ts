/**
 * event-bus — tests/outbox-worker.integration.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { tryOpenIsolatedPg } from 'object-platform';

import { createPgOutboxRepository } from '../src/store/pg-outbox-repository.js';
import { createOutboxWorker } from '../src/worker/outbox-worker.js';
import { createSqlMirrorWritebackHandler } from '../src/writeback/handler.js';
import { createPgWritebackExecutionStore } from '../src/writeback/executions.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('outbox worker', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('drainOnce writes erp_writeback_queue and dead-letters after maxAttempts', async () => {
    if (!db) return;
    const eventId = randomUUID();
    const repo = createPgOutboxRepository({ sql: db.sql });
    await repo.insert({
      eventId,
      topic: 'action.side_effect.writeback',
      key: 'k1',
      payload: { kind: 'connector_writeback', connectorId: 'erp', operation: 'update' },
      principal: 'u1',
      traceId: eventId,
    });

    const executions = createPgWritebackExecutionStore({ sql: db.sql });
    const ok = createOutboxWorker({
      sql: db.sql,
      handlers: {
        'action.side_effect.writeback': createSqlMirrorWritebackHandler({
          sql: db.sql,
          table: 'erp_writeback_queue',
          executions,
        }),
      },
    });
    expect(await ok.drainOnce()).toBeGreaterThanOrEqual(1);
    const queued = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM erp_writeback_queue WHERE event_id = $1`,
      [eventId],
    );
    expect(queued.rows[0]?.n).toBe('1');
    const delivered = await db.sql.query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at::text FROM outbox_events WHERE event_id = $1`,
      [eventId],
    );
    expect(delivered.rows[0]?.status).toBe('DELIVERED');
    expect(delivered.rows[0]?.published_at).toBeTruthy();
    const execs = await executions.listByEvent(eventId);
    expect(execs.some((e) => e.status === 'SUCCEEDED')).toBe(true);

    const boomId = randomUUID();
    await repo.insert({
      eventId: boomId,
      topic: 'action.side_effect.writeback',
      key: 'k2',
      payload: { boom: true },
      principal: 'u1',
      traceId: boomId,
    });
    const failing = createOutboxWorker({
      sql: db.sql,
      maxAttempts: 2,
      backoff: { random: () => 0.5, schedule: [0, 0] },
      onError: () => {},
      onDeadLetter: () => {},
      handlers: {
        'action.side_effect.writeback': async () => {
          throw new Error('erp down');
        },
      },
    });
    await failing.drainOnce();
    await failing.drainOnce();
    const dead = await db.sql.query<{
      status: string;
      published_at: string | null;
      dead_lettered_at: string | null;
    }>(
      `SELECT status, published_at::text, dead_lettered_at::text
       FROM outbox_events WHERE event_id = $1`,
      [boomId],
    );
    expect(dead.rows[0]?.status).toBe('DEAD_LETTER');
    expect(dead.rows[0]?.published_at).toBeNull();
    expect(dead.rows[0]?.dead_lettered_at).toBeTruthy();
  });
});
