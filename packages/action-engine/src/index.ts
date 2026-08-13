/**
 * action-engine — src/index.ts
 */

export type {
  CreateActionExecutorOptions,
  Clock,
  IdGenerator,
  ActionTransactionStores,
  ActionUnitOfWork,
} from './core/types.js';
export {
  createActionExecutor,
  createMemoryOperationalEventStore,
  createMemoryActionExecutionStore,
} from './core/executor.js';
export { createPgOperationalEventStore } from './core/pg-events.js';
export type { CreatePgOperationalEventStoreOptions } from './core/pg-events.js';
export { createPgActionExecutionStore } from './core/pg-execution-store.js';
export type { CreatePgActionExecutionStoreOptions } from './core/pg-execution-store.js';
export { createMemoryOutboxRepository } from './core/memory-outbox.js';
export { createFailureSurvivingExecutor } from './core/failure-surviving-executor.js';
