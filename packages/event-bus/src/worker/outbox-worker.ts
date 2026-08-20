/**
 * event-bus — operational outbox worker (ADR-0021).
 *
 * Claim via OutboxDispatcher (same table/port as insert). Handler runs after
 * claim commits. Delivery is at-least-once; poison → DEAD_LETTER.
 */

import type { OutboxDispatchRecord, OutboxDispatcher } from 'contracts';
import { createSystemClock, createUuidIdGenerator, type Clock, type IdGenerator } from 'object-platform';

import { computeBackoffMs, type BackoffOptions } from './backoff.js';
import type { OutboxEventRow, OutboxHandler, OutboxStatus } from './types.js';

export type { OutboxEventRow, OutboxHandler, OutboxStatus } from './types.js';

export interface CreateOutboxWorkerOptions {
  dispatcher: OutboxDispatcher;
  handlers: Record<string, OutboxHandler>;
  batchSize?: number;
  pollIntervalMs?: number;
  /** Attempts before DEAD_LETTER. Default 8. */
  maxAttempts?: number;
  /** Claim lease duration. Default 30s. */
  leaseMs?: number;
  workerId?: string;
  clock?: Clock;
  nextId?: IdGenerator;
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

function toEventRow(rec: OutboxDispatchRecord): OutboxEventRow {
  return {
    eventId: rec.eventId,
    topic: rec.topic,
    orderingKey: rec.orderingKey,
    payload: rec.payload,
    principal: rec.principal,
    tenantId: rec.tenantId,
    traceId: rec.traceId,
    createdAt: rec.createdAt,
    attempts: rec.attempts,
    status: rec.status as OutboxStatus,
  };
}

export function createOutboxWorker(opts: CreateOutboxWorkerOptions): OutboxWorker {
  const {
    dispatcher,
    handlers,
    batchSize = 20,
    pollIntervalMs = 1000,
    maxAttempts = 8,
    leaseMs = 30_000,
    backoff,
  } = opts;
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();
  const workerId = opts.workerId ?? nextId('outbox-worker');
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

  async function markFailure(ev: OutboxEventRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const now = clock();
    if (ev.attempts >= maxAttempts) {
      onDeadLetter(ev, err);
      await dispatcher.markDeadLetter(ev.eventId, message, now);
      return;
    }
    const delayMs = computeBackoffMs(ev.attempts, backoff);
    const nextAttemptAt = new Date(Date.parse(now) + delayMs).toISOString();
    await dispatcher.markRetry(ev.eventId, nextAttemptAt, message, now);
  }

  async function drainOnce(): Promise<number> {
    const now = clock();
    const claimed = await dispatcher.claimBatch({
      workerId,
      now,
      leaseMs,
      limit: batchSize,
    });
    for (const rec of claimed) {
      const ev = toEventRow(rec);
      if (ev.attempts > maxAttempts) {
        await markFailure(ev, new Error('max attempts exceeded after lease reclaim'));
        continue;
      }
      const handler = handlers[ev.topic];
      if (!handler) {
        onUnhandled(ev);
        await dispatcher.markUnhandled(ev.eventId, clock());
        continue;
      }
      try {
        await handler(ev);
        await dispatcher.markDelivered(ev.eventId, clock());
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
