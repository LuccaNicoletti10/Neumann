#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { InMemoryTransactionalStore } from './store/memory-outbox.js';
import { OutboxPublisher } from './publisher.js';
import { IdempotentConsumer } from './consumer.js';
import { withOutbox } from './with-outbox.js';
import { startDemoServer } from './api/demo-server.js';
import { isEventBusCommand, parseEventBusArgs } from './cli-args.js';
import { runGateScenario } from './gate.js';

async function runDemo(): Promise<number> {
  const store = new InMemoryTransactionalStore();
  const consumer = new IdempotentConsumer();
  const delivered: string[] = [];

  const publisher = new OutboxPublisher(store, async (record) => {
    const handled = await consumer.handle(record, (event) => {
      console.log(JSON.stringify({ delivered: event.event_id, topic: event.source_object }));
    });
    if (handled) delivered.push(record.eventId);
  });

  publisher.start();

  await withOutbox(store, (tx) => {
    tx.writeBusiness('orders', { id: 1, total: 99 });
    tx.insertOutbox({
      topic: 'orders',
      key: 'orders+1',
      payload: { id: 1, total: 99 },
      principal: 'demo-user',
      tenantId: 'tenant-a',
      traceId: randomUUID(),
    });
  });

  await publisher.tick();
  publisher.stop();

  const rows = store.getBusinessRows('orders');
  if (rows.length !== 1 || delivered.length !== 1) {
    console.error('demo failed: business or delivery missing');
    return 1;
  }

  console.log('demo ok');
  return 0;
}

async function runServe(argv: string[]): Promise<number> {
  const portFlag = argv.indexOf('--port');
  const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : 8787;
  const handle = await startDemoServer({ port });
  console.log(`event-bus listening on http://127.0.0.1:${handle.port}`);
  await new Promise<void>(() => {});
  return 0;
}

async function main(): Promise<number> {
  const { command, rest } = parseEventBusArgs(process.argv.slice(2));

  if (!isEventBusCommand(command)) {
    console.error('usage: event-bus <demo|serve|gate> [--port N]');
    return 1;
  }

  switch (command) {
    case 'demo':
      return runDemo();
    case 'serve':
      return runServe(rest);
    case 'gate':
      return runGateScenario();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
