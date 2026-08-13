/**
 * event-bus — operational outbox worker.
 *
 * TX1: claim row (PROCESSING + lease) and COMMIT.
 * Then run the handler (HTTP allowed — no open row lock).
 * TX2: DELIVERED / RETRYING / DEAD_LETTER / UNHANDLED.
 *
 * Expired leases are reclaimed. published_at is set only on DELIVERED.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from 'contracts';

import { computeBackoffMs, type BackoffOptions } from './backoff.js';
import type { OutboxEventRow, OutboxHandler, OutboxStatus } from './types.js';

export type { OutboxEventRow, OutboxHandler, OutboxStatus } from './types.js';

export interface CreateOutboxWorkerOptions {
  sql: SqlClient & {
    transaction?: <T>(fn: (tx: SqlClient) => Promise<T>) => Promise<T>;
  };
  handlers: Record<string, OutboxHandler>;
  batchSize?: number;
  pollIntervalMs?: number;
  /** Attempts before DEAD_LETTER. Default 8. */
  maxAttempts?: number;
  /** Claim lease duration. Default 30s. */
  leaseMs?: number;
  workerId?: string;
  backoff?: BackoffOptions;
  onError?: (event: OutboxEventRow, error: unknown) => void;
  onDeadLetter?: (event: OutboxEventRow, error: unknown) => void;
  onUnhandled?: (event: OutboxEventRow) => void;
}

export interface OutboxWorker {
  drainOnce(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
  running(): boolean;
}

function rowToEvent(row: Record<string, unknown>): OutboxEventRow {
  const ev: OutboxEventRow = {
    eventId: String(row.event_id),
    topic: String(row.topic),
    orderingKey: String(row.ordering_key),
    payload: (row.payload as Record<string, unknown>) ?? {},
    principal: String(row.principal),
    tenantId: String(row.tenant_id ?? 'default'),
    traceId: String(row.trace_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    attempts: Number(row.attempts ?? 0),
    status: String(row.status ?? 'PENDING') as OutboxStatus,
  };
  if (row.next_attempt_at) ev.nextAttemptAt = new Date(String(row.next_attempt_at)).toISOString();
  if (row.last_error != null) ev.lastError = String(row.last_error);
  if (row.locked_by != null) ev.lockedBy = String(row.locked_by);
  if (row.lease_until) ev.leaseUntil = new Date(String(row.lease_until)).toISOString();
  return ev;
}

export function createOutboxWorker(opts: CreateOutboxWorkerOptions): OutboxWorker {
  const {
    sql,
    handlers,
    batchSize = 20,
    pollIntervalMs = 1000,
    maxAttempts = 8,
    leaseMs = 30_000,
    backoff,
  } = opts;
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const onError = opts.onError ?? (() => {});
  const onDeadLetter =
    opts.onDeadLetter ??
    ((ev, err) => console.error(`[outbox] DEAD_LETTER ${ev.eventId} topic=${ev.topic}:`, err));
  const onUnhandled =
    opts.onUnhandled ??
    ((ev) => console.error(`[outbox] UNHANDLED ${ev.eventId} topic=${ev.topic}`));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let inFlight: Promise<void> = Promise.resolve();

  async function inTx<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    if (!sql.transaction) {
      throw new Error(
        'createOutboxWorker requires sql.transaction so HTTP runs after claim commit',
      );
    }
    return sql.transaction(fn);
  }

  async function claimBatch(): Promise<OutboxEventRow[]> {
    return inTx(async (tx) => {
      const res = await tx.query(
        `WITH batch AS (
           SELECT event_id
           FROM outbox_events
           WHERE (
               (status IN ('PENDING', 'RETRYING') AND next_attempt_at <= now())
               OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until < now())
             )
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE outbox_events AS o
         SET status = 'PROCESSING',
             locked_at = now(),
             locked_by = $2,
             lease_until = now() + ($3::int * interval '1 millisecond'),
             last_attempt_at = now(),
             attempts = o.attempts + 1
         FROM batch
         WHERE o.event_id = batch.event_id
         RETURNING o.*`,
        [batchSize, workerId, leaseMs],
      );
      return (res.rows as Record<string, unknown>[]).map(rowToEvent);
    });
  }

  async function markDelivered(eventId: string): Promise<void> {
    await inTx((tx) =>
      tx.query(
        `UPDATE outbox_events
         SET status = 'DELIVERED',
             published_at = now(),
             delivered_at = now(),
             locked_at = NULL,
             locked_by = NULL,
             lease_until = NULL,
             last_error = NULL
         WHERE event_id = $1`,
        [eventId],
      ),
    );
  }

  async function markUnhandled(eventId: string): Promise<void> {
    await inTx((tx) =>
      tx.query(
        `UPDATE outbox_events
         SET status = 'UNHANDLED',
             published_at = NULL,
             locked_at = NULL,
             locked_by = NULL,
             lease_until = NULL,
             last_error = 'no handler registered for topic'
         WHERE event_id = $1`,
        [eventId],
      ),
    );
  }

  async function markFailure(ev: OutboxEventRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    if (ev.attempts >= maxAttempts) {
      onDeadLetter(ev, err);
      await inTx((tx) =>
        tx.query(
          `UPDATE outbox_events
           SET status = 'DEAD_LETTER',
               published_at = NULL,
               dead_lettered_at = now(),
               last_error = $2,
               locked_at = NULL,
               locked_by = NULL,
               lease_until = NULL
           WHERE event_id = $1`,
          [ev.eventId, message],
        ),
      );
      return;
    }
    const delayMs = computeBackoffMs(ev.attempts, backoff);
    await inTx((tx) =>
      tx.query(
        `UPDATE outbox_events
         SET status = 'RETRYING',
             published_at = NULL,
             next_attempt_at = now() + ($2::int * interval '1 millisecond'),
             last_error = $3,
             locked_at = NULL,
             locked_by = NULL,
             lease_until = NULL
         WHERE event_id = $1`,
        [ev.eventId, delayMs, message],
      ),
    );
  }

  async function drainOnce(): Promise<number> {
    const claimed = await claimBatch();
    for (const ev of claimed) {
      if (ev.attempts > maxAttempts) {
        await markFailure(ev, new Error('max attempts exceeded after lease reclaim'));
        continue;
      }
      const handler = handlers[ev.topic];
      if (!handler) {
        onUnhandled(ev);
        await markUnhandled(ev.eventId);
        continue;
      }
      try {
        await handler(ev);
        await markDelivered(ev.eventId);
      } catch (err) {
        onError(ev, err);
        await markFailure(ev, err);
      }
    }
    return claimed.length;
  }

  function schedule() {
    if (!active) return;
    timer = setTimeout(() => {
      inFlight = drainOnce()
        .catch((err) => console.error('[outbox] cycle failed:', err))
        .then(() => schedule()) as Promise<void>;
    }, pollIntervalMs);
  }

  return {
    drainOnce,
    start() {
      if (active) return;
      active = true;
      schedule();
    },
    async stop() {
      active = false;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
    running: () => active,
  };
}
