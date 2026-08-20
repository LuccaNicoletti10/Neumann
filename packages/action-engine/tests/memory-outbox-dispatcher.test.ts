/**
 * action-engine — memory OutboxDispatcher claim/ack/DLQ (ADR-0021).
 */
import { describe, expect, it } from 'vitest';

import { createMemoryOutboxRepository } from '../src/core/memory-outbox.js';

const FROZEN = '2026-08-20T15:00:00.000Z';

describe('OutboxDispatcher memory', () => {
  it('claim CAS, retry, and dead-letter without a second store', async () => {
    const repo = createMemoryOutboxRepository({ clock: () => FROZEN });
    await repo.insert({
      eventId: 'e1',
      topic: 't.work',
      key: 'k',
      payload: { n: 1 },
      principal: 'u',
      traceId: 'tr1',
    });
    const first = await repo.claimBatch({
      workerId: 'w1',
      now: FROZEN,
      leaseMs: 30_000,
      limit: 10,
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.attempts).toBe(1);
    const empty = await repo.claimBatch({
      workerId: 'w2',
      now: FROZEN,
      leaseMs: 30_000,
      limit: 10,
    });
    expect(empty).toHaveLength(0);

    await repo.markRetry('e1', FROZEN, 'crash before ack', FROZEN);
    const again = await repo.claimBatch({
      workerId: 'w1',
      now: FROZEN,
      leaseMs: 30_000,
      limit: 10,
    });
    expect(again[0]?.attempts).toBe(2);
    await repo.markDeadLetter('e1', 'poison', FROZEN);
    expect(repo.rows[0]?.status).toBe('DEAD_LETTER');
    expect(
      await repo.claimBatch({
        workerId: 'w3',
        now: '2099-01-01T00:00:00.000Z',
        leaseMs: 1000,
        limit: 10,
      }),
    ).toHaveLength(0);
  });

  it('markDelivered and markUnhandled terminate claim eligibility', async () => {
    const repo = createMemoryOutboxRepository({ clock: () => FROZEN });
    await repo.insert({
      eventId: 'e-ok',
      topic: 't.a',
      key: 'k',
      payload: {},
      principal: 'u',
      traceId: 'tr',
    });
    await repo.insert({
      eventId: 'e-miss',
      topic: 't.b',
      key: 'k',
      payload: {},
      principal: 'u',
      traceId: 'tr',
    });
    const claimed = await repo.claimBatch({
      workerId: 'w',
      now: FROZEN,
      leaseMs: 1000,
      limit: 10,
    });
    expect(claimed).toHaveLength(2);
    await repo.markDelivered('e-ok', FROZEN);
    await repo.markUnhandled('e-miss', FROZEN);
    expect(repo.rows.find((r) => r.eventId === 'e-ok')?.status).toBe('DELIVERED');
    expect(repo.rows.find((r) => r.eventId === 'e-miss')?.status).toBe('UNHANDLED');
    expect(
      await repo.listRequests({ topic: 't.a' }),
    ).toEqual([
      expect.objectContaining({ topic: 't.a', key: 'k' }),
    ]);
  });
});
