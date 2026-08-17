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
export {
  parseConnectorYaml,
  emptyState,
  mergeState,
  type ConnectorV2,
  type ConnectorSpec,
  type ConnectorState,
  type ConnectorProtocolMessage,
  type ConnectorYaml,
} from './core/protocol.js';
export { asConnectorV2 } from './core/as-v2.js';
export { runCommandLine } from './cli.js';
export type { CliDeps } from './cli.js';
export {
  propertiesToSourceFields,
  sourceFieldsToProperties,
} from './core/inverse-map.js';
export {
  createMemoryWriteBackConnector,
  type MemoryWriteBackConnector,
} from './core/memory-writeback.js';
