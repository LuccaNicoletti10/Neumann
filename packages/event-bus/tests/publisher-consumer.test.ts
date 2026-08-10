import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryTransactionalStore } from '../src/store/memory-outbox.js';
import { OutboxPublisher } from '../src/publisher.js';
import { IdempotentConsumer } from '../src/consumer.js';
import { withOutbox } from '../src/with-outbox.js';

describe('OutboxPublisher + IdempotentConsumer', () => {
  it('delivers at least once and marks published', async () => {
    const store = new InMemoryTransactionalStore();
    const consumer = new IdempotentConsumer();
    const seen: string[] = [];

    const publisher = new OutboxPublisher(store, async (record) => {
      await consumer.handle(record, (event) => {
        seen.push(event.event_id);
      });
    });

    const eventId = randomUUID();
    await withOutbox(store, (tx) => {
      tx.insertOutbox({
        eventId,
        topic: 'items',
        key: 'items+1',
        payload: { n: 1 },
        principal: 'p',
        tenantId: 't',
        traceId: randomUUID(),
      });
    });

    publisher.start();
    await publisher.tick();
    publisher.stop();

    expect(seen).toEqual([eventId]);
    expect(store.listUnpublished()).toHaveLength(0);
  });

  it('absorbs duplicate delivery via idempotency', async () => {
    const store = new InMemoryTransactionalStore();
    const consumer = new IdempotentConsumer();
    let businessRuns = 0;

    const eventId = randomUUID();
    await withOutbox(store, (tx) => {
      tx.insertOutbox({
        eventId,
        topic: 'dup',
        key: 'dup+1',
        payload: {},
        principal: 'p',
        tenantId: 't',
        traceId: randomUUID(),
      });
    });

    const record = store.listUnpublished()[0]!;
    const publisher = new OutboxPublisher(store, async (r) => {
      await consumer.handle(r, () => {
        businessRuns += 1;
      });
    });

    publisher.start();
    await publisher.tick();
    await publisher.tick();
    publisher.stop();

    expect(businessRuns).toBe(1);
  });

  it('preserves ordering by key', async () => {
    const store = new InMemoryTransactionalStore();
    const consumer = new IdempotentConsumer();
    const order: number[] = [];

    await withOutbox(store, (tx) => {
      for (const n of [1, 2, 3]) {
        tx.insertOutbox({
          topic: 'seq',
          key: 'seq+same',
          payload: { n },
          principal: 'p',
          tenantId: 't',
          traceId: randomUUID(),
        });
      }
    });

    const publisher = new OutboxPublisher(store, async (record) => {
      await consumer.handle(record, (event) => {
        order.push((event.payload as { n: number }).n);
      });
    });

    publisher.start();
    await publisher.tick();
    publisher.stop();

    expect(order).toEqual([1, 2, 3]);
  });
});
