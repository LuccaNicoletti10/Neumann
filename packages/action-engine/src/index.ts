/**
 * action-engine — src/index.ts
 */

export type { CreateActionExecutorOptions, Clock, IdGenerator } from './core/types.js';
export {
  createActionExecutor,
  createMemoryOperationalEventStore,
} from './core/executor.js';
