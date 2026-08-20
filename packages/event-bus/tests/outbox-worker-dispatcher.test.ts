/**
 * event-bus — OutboxWorker unit paths via fake OutboxDispatcher (ADR-0021).
 */
import { describe, expect, it, vi } from 'vitest';

import type { OutboxDispatchRecord, OutboxDispatcher } from 'contracts';

import { createOutboxWorker } from '../src/worker/outbox-worker.js';

function fakeDispatcher(seed: OutboxDispatchRecord[]): OutboxDispatcher & {
  delivered: string[];
  retried: string[];
  dead: string[];
  unhandled: string[];
} {
  const rows = [...seed];
  const delivered: string[] = [];
  const retried: string[] = [];
  const dead: string[] = [];
  const unhandled: string[] = [];
  return {
    delivered,
    retried,
    dead,
    unhandled,
    async claimBatch(input) {
      const out: OutboxDispatchRecord[] = [];
      for (const row of rows) {
        if (out.length >= input.limit) break;
        if (row.status !== 'PENDING' && row.status !== 'RETRYING') continue;
        row.status = 'PROCESSING';
        row.attempts += 1;
        out.push({ ...row });
      }
      return out;
    },
    async markDelivered(eventId) {
      delivered.push(eventId);
      const row = rows.find((r) => r.eventId === eventId);
      if (row) row.status = 'DELIVERED';
    },
    async markRetry(eventId) {
      retried.push(eventId);
      const row = rows.find((r) => r.eventId === eventId);
      if (row) row.status = 'RETRYING';
    },
    async markDeadLetter(eventId) {
      dead.push(eventId);
      const row = rows.find((r) => r.eventId === eventId);
      if (row) row.status = 'DEAD_LETTER';
    },
    async markUnhandled(eventId) {
      unhandled.push(eventId);
      const row = rows.find((r) => r.eventId === eventId);
      if (row) row.status = 'UNHANDLED';
    },
  };
}

function pending(eventId: string, topic: string): OutboxDispatchRecord {
  return {
    eventId,
    topic,
    orderingKey: 'k',
    payload: {},
    principal: 'u',
    tenantId: 'default',
    traceId: 'tr',
    createdAt: '2026-08-20T00:00:00.000Z',
    attempts: 0,
    status: 'PENDING',
  };
}

describe('createOutboxWorker dispatcher port', () => {
  it('acks success, unhandled topics, retries then dead-letters, and start/stop', async () => {
    const disp = fakeDispatcher([
      pending('ok-1', 't.ok'),
      pending('miss-1', 't.missing'),
      pending('bad-1', 't.fail'),
    ]);
    const worker = createOutboxWorker({
      dispatcher: disp,
      maxAttempts: 1,
      backoff: { random: () => 0.5, schedule: [0] },
      clock: () => '2026-08-20T00:00:00.000Z',
      nextId: () => 'w-test',
      onError: () => {},
      onDeadLetter: () => {},
      onUnhandled: () => {},
      handlers: {
        't.ok': async () => {},
        't.fail': async () => {
          throw new Error('boom');
        },
      },
    });
    expect(await worker.drainOnce()).toBe(3);
    expect(disp.delivered).toEqual(['ok-1']);
    expect(disp.unhandled).toEqual(['miss-1']);
    expect(disp.dead).toEqual(['bad-1']);

    expect(worker.running()).toBe(false);
    worker.start();
    expect(worker.running()).toBe(true);
    worker.start();
    await worker.stop();
    expect(worker.running()).toBe(false);
  });

  it('schedules a poll cycle without throwing', async () => {
    vi.useFakeTimers();
    try {
      const disp = fakeDispatcher([pending('late-1', 't.ok')]);
      const worker = createOutboxWorker({
        dispatcher: disp,
        pollIntervalMs: 5,
        clock: () => '2026-08-20T00:00:00.000Z',
        nextId: () => 'w-poll',
        handlers: { 't.ok': async () => {} },
      });
      worker.start();
      await vi.advanceTimersByTimeAsync(20);
      await worker.stop();
      expect(disp.delivered).toContain('late-1');
    } finally {
      vi.useRealTimers();
    }
  });
});
