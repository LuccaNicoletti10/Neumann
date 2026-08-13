/**
 * event-bus — tests/outbox-worker.integration.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { tryOpenIsolatedPg } from 'object-platform';

import { createPgOutboxRepository } from '../src/store/pg-outbox-repository.js';
import {
  createOutboxWorker,
  createSqlMirrorWritebackHandler,
} from '../src/worker/outbox-worker.js';

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
      payload: { kind: 'connector_writeback' },
      principal: 'u1',
      traceId: eventId,
    });

    const ok = createOutboxWorker({
      sql: db.sql,
      handlers: {
        'action.side_effect.writeback': createSqlMirrorWritebackHandler({
          sql: db.sql,
          table: 'erp_writeback_queue',
        }),
      },
    });
    expect(await ok.drainOnce()).toBeGreaterThanOrEqual(1);
    const queued = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM erp_writeback_queue WHERE event_id = $1`,
      [eventId],
    );
    expect(queued.rows[0]?.n).toBe('1');

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
    const dead = await db.sql.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events WHERE event_id = $1`,
      [boomId],
    );
    expect(dead.rows[0]?.payload.__dead_letter).toBe(true);
  });
});
