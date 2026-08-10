import { randomUUID } from 'node:crypto';
import { InMemoryTransactionalStore } from './store/memory-outbox.js';
import { OutboxPublisher } from './publisher.js';
import { IdempotentConsumer } from './consumer.js';
import { withOutbox } from './with-outbox.js';

export async function runGateScenario(): Promise<number> {
  const store = new InMemoryTransactionalStore();
  const consumer = new IdempotentConsumer();
  const businessRuns: string[] = [];
  let simulateCrashBeforeMark = true;

  const eventId = randomUUID();

  await withOutbox(store, (tx) => {
    tx.writeBusiness('gate', { eventId, status: 'committed' });
    tx.insertOutbox({
      eventId,
      topic: 'gate',
      key: `gate+${eventId}`,
      payload: { eventId },
      principal: 'gate-runner',
      tenantId: 'gate',
      traceId: randomUUID(),
    });
  });

  const publisher1 = new OutboxPublisher(store, async (record) => {
    await consumer.handle(record, (event) => {
      businessRuns.push(event.event_id);
    });
    if (simulateCrashBeforeMark) {
      throw new Error('simulated publisher crash before markPublished');
    }
  });

  publisher1.start();
  await publisher1.tick();
  publisher1.stop();

  if (store.listUnpublished().length === 0) {
    console.error('gate failed: expected unpublished record after simulated crash');
    return 1;
  }

  simulateCrashBeforeMark = false;
  const publisher2 = new OutboxPublisher(store, async (record) => {
    await consumer.handle(record, (event) => {
      businessRuns.push(event.event_id);
    });
  });

  publisher2.start();
  await publisher2.tick();
  publisher2.stop();

  if (businessRuns.length !== 1 || businessRuns[0] !== eventId) {
    console.error('gate failed: business handler must run exactly once');
    return 1;
  }

  if (store.listUnpublished().length !== 0) {
    console.error('gate failed: outbox still has unpublished records');
    return 1;
  }

  console.log('gate ok: committed event delivered exactly once after restart');
  return 0;
}
