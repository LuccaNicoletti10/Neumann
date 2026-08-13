export type { OutboxRecord, CanonicalEvent, Clock } from './types.js';
export { FakeClock, toCanonicalEvent } from './types.js';

export {
  InMemoryTransactionalStore,
  OUTBOX_NOTIFY_CHANNEL,
  type OutboxStore,
  type OutboxTransaction,
  type BusinessRow,
} from './store/memory-outbox.js';

export {
  PostgresOutboxStore,
  OUTBOX_SCHEMA_SQL,
  createPostgresOutboxStore,
} from './store/postgres-outbox.js';
export { createPgOutboxRepository } from './store/pg-outbox-repository.js';

export { OutboxPublisher, type PublishHandler, type OutboxPublisherOptions } from './publisher.js';
export { IdempotentConsumer, type EventHandler } from './consumer.js';
export { withOutbox } from './with-outbox.js';

export {
  InMemoryJobQueue,
  type Job,
  type JobQueue,
  type InMemoryJobQueueOptions,
} from './jobs/queue.js';

export {
  createPgBoss,
  enqueuePgBossJob,
  type PgBossHandle,
} from './jobs/pg-boss-adapter.js';

export { startDemoServer, type DemoServerHandle, type DemoServerOptions } from './api/demo-server.js';
export { runGateScenario } from './gate.js';
