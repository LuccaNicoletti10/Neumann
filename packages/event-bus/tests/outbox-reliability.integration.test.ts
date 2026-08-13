/**
 * event-bus — backoff, UNHANDLED, lease reclaim.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { tryOpenIsolatedPg } from 'object-platform';

import { createPgOutboxRepository } from '../src/store/pg-outbox-repository.js';
import { createOutboxWorker } from '../src/worker/outbox-worker.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('outbox reliability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('RETRYING uses next_attempt_at; UNHANDLED is not published', async () => {
    if (!db) return;
    const repo = createPgOutboxRepository({ sql: db.sql });
    const retryId = randomUUID();
    await repo.insert({
      eventId: retryId,
      topic: 'action.side_effect.writeback',
      key: 'retry',
      payload: { n: 1 },
      principal: 'u1',
      traceId: retryId,
    });
    const worker = createOutboxWorker({
      sql: db.sql,
      maxAttempts: 8,
      backoff: { random: () => 0.5, schedule: [60_000] },
      onError: () => {},
      handlers: {
        'action.side_effect.writeback': async () => {
          throw new Error('temporary');
        },
      },
    });
    expect(await worker.drainOnce()).toBe(1);
    const row = await db.sql.query<{
      status: string;
      published_at: string | null;
      next_ms: number;
    }>(
      `SELECT status, published_at::text,
              (extract(epoch from (next_attempt_at - now())) * 1000)::int AS next_ms
       FROM outbox_events WHERE event_id = $1`,
      [retryId],
    );
    expect(row.rows[0]?.status).toBe('RETRYING');
    expect(row.rows[0]?.published_at).toBeNull();
    expect(Number(row.rows[0]?.next_ms)).toBeGreaterThan(10_000);
    expect(await worker.drainOnce()).toBe(0);

    const unhandledId = randomUUID();
    await repo.insert({
      eventId: unhandledId,
      topic: 'action.side_effect.unknown',
      key: 'u',
      payload: {},
      principal: 'u1',
      traceId: unhandledId,
    });
    const alerts: string[] = [];
    const w2 = createOutboxWorker({
      sql: db.sql,
      handlers: {},
      onUnhandled: (ev) => alerts.push(ev.eventId),
    });
    expect(await w2.drainOnce()).toBe(1);
    expect(alerts).toEqual([unhandledId]);
    const un = await db.sql.query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at::text FROM outbox_events WHERE event_id = $1`,
      [unhandledId],
    );
    expect(un.rows[0]?.status).toBe('UNHANDLED');
    expect(un.rows[0]?.published_at).toBeNull();
  });

  it('expired PROCESSING lease is reclaimed by another worker', async () => {
    if (!db) return;
    const repo = createPgOutboxRepository({ sql: db.sql });
    const eventId = randomUUID();
    await repo.insert({
      eventId,
      topic: 'action.side_effect.writeback',
      key: 'lease',
      payload: { ok: true },
      principal: 'u1',
      traceId: eventId,
    });

    let resolveHang: () => void = () => {};
    const hung = new Promise<void>((resolve) => {
      resolveHang = resolve;
    });
    const stuck = createOutboxWorker({
      sql: db.sql,
      workerId: 'stuck',
      leaseMs: 60_000,
      handlers: {
        'action.side_effect.writeback': async () => hung,
      },
    });
    const draining = stuck.drainOnce();
    let processing: { status: string; locked_by: string } | undefined;
    for (let i = 0; i < 40; i += 1) {
      const hit = await db.sql.query<{ status: string; locked_by: string }>(
        `SELECT status, locked_by FROM outbox_events WHERE event_id = $1`,
        [eventId],
      );
      processing = hit.rows[0];
      if (processing?.status === 'PROCESSING') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(processing?.status).toBe('PROCESSING');
    expect(processing?.locked_by).toBe('stuck');

    await db.sql.query(`UPDATE outbox_events SET lease_until = now() - interval '1 second' WHERE event_id = $1`, [
      eventId,
    ]);

    const rescuer = createOutboxWorker({
      sql: db.sql,
      workerId: 'rescuer',
      handlers: {
        'action.side_effect.writeback': async () => {},
      },
    });
    expect(await rescuer.drainOnce()).toBe(1);
    const done = await db.sql.query<{ status: string }>(
      `SELECT status FROM outbox_events WHERE event_id = $1`,
      [eventId],
    );
    expect(done.rows[0]?.status).toBe('DELIVERED');
    resolveHang();
    await draining.catch(() => undefined);
  });
});
