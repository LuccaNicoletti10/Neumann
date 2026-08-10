import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryTransactionalStore } from '../src/store/memory-outbox.js';
import { OutboxPublisher } from '../src/publisher.js';
import { IdempotentConsumer } from '../src/consumer.js';
import { withOutbox } from '../src/with-outbox.js';
import { runGateScenario } from '../src/gate.js';

describe('TM0.3 gate', () => {
  it('delivers committed event exactly once after publisher restart', async () => {
    const store = new InMemoryTransactionalStore();
    const consumer = new IdempotentConsumer();
    const businessRuns: string[] = [];
    let simulateCrashBeforeMark = true;

    const eventId = randomUUID();
    await withOutbox(store, (tx) => {
      tx.writeBusiness('gate', { eventId });
      tx.insertOutbox({
        eventId,
        topic: 'gate',
        key: `gate+${eventId}`,
        payload: { eventId },
        principal: 'gate',
        tenantId: 'gate',
        traceId: randomUUID(),
      });
    });

    const publisher1 = new OutboxPublisher(store, async (record) => {
      await consumer.handle(record, (event) => {
        businessRuns.push(event.event_id);
      });
      if (simulateCrashBeforeMark) {
        throw new Error('crash before markPublished');
      }
    });

    publisher1.start();
    await publisher1.tick();
    publisher1.stop();

    expect(store.listUnpublished()).toHaveLength(1);
    expect(businessRuns).toEqual([eventId]);

    simulateCrashBeforeMark = false;
    const publisher2 = new OutboxPublisher(store, async (record) => {
      await consumer.handle(record, (event) => {
        businessRuns.push(event.event_id);
      });
    });

    publisher2.start();
    await publisher2.tick();
    publisher2.stop();

    expect(businessRuns).toEqual([eventId]);
    expect(store.listUnpublished()).toHaveLength(0);
  });

  it('runGateScenario exits successfully', async () => {
    const code = await runGateScenario();
    expect(code).toBe(0);
  });
});
