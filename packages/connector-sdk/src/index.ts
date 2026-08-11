/**
 * connector-sdk — src/index.ts
 */

export type { Clock, IdGenerator } from './core/types.js';
export {
  DEFAULT_EPOCH,
  createDeterministicClock,
  createFixedClock,
  createIdGenerator,
} from './core/determinism.js';
export {
  validateConnectorShape,
  assertConnectorShape,
  type ConnectorValidationResult,
} from './core/validate.js';
export {
  createMemoryCheckpointStore,
  type CheckpointStore,
} from './core/checkpoint-store.js';
export {
  createEventFactory,
  type EventFactory,
  type EventFactoryInput,
  type EventFactoryOptions,
} from './core/event-factory.js';
export { runSnapshot, runIncremental, type RunOptions, type RunResult } from './core/runner.js';
export { runCommandLine } from './cli.js';
export type { CliDeps } from './cli.js';
