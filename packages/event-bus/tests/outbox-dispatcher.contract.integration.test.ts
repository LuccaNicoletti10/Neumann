/**
 * event-bus — OutboxDispatcher PostgreSQL claim/ack/DLQ (ADR-0021).
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import { createPgOutboxRepository } from '../src/store/pg-outbox-repository.js';
import { createOutboxWorker } from '../src/worker/outbox-worker.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('OutboxDispatcher PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('redelivers after crash-before-ack and dead-letters poison', async () => {
    if (!db) return;
    const repo = createPgOutboxRepository({ sql: db.sql });
    await repo.insert({
      eventId: 'pg-e1',
      topic: 't.work',
      key: 'k',
      payload: { n: 1 },
      principal: 'u',
      traceId: 'pg-tr1',
    });
    let delivered = 0;
    let crash = true;
    const worker = createOutboxWorker({
      dispatcher: repo,
      maxAttempts: 2,
      backoff: { random: () => 0.5, schedule: [0] },
      onError: () => {},
      onDeadLetter: () => {},
      handlers: {
        't.work': async () => {
          delivered += 1;
          if (crash) {
            crash = false;
            throw new Error('crash before ack');
          }
        },
      },
    });
    expect(await worker.drainOnce()).toBe(1);
    expect(delivered).toBe(1);
    expect(await worker.drainOnce()).toBe(1);
    expect(delivered).toBe(2);

    await repo.insert({
      eventId: 'pg-e2',
      topic: 't.poison',
      key: 'p',
      payload: {},
      principal: 'u',
      traceId: 'pg-tr2',
    });
    const poison = createOutboxWorker({
      dispatcher: repo,
      maxAttempts: 2,
      backoff: { random: () => 0.5, schedule: [0] },
      onError: () => {},
      onDeadLetter: () => {},
      handlers: {
        't.poison': async () => {
          throw new Error('poison');
        },
      },
    });
    await poison.drainOnce();
    await poison.drainOnce();
    const status = await db.sql.query<{ status: string }>(
      `SELECT status FROM outbox_events WHERE event_id = $1`,
      ['pg-e2'],
    );
    expect(status.rows[0]?.status).toBe('DEAD_LETTER');
  });
});
