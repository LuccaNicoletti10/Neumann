/**
 * offline-sync — src/index.ts
 */

export { createDeterministicClock, createIdGenerator, type Clock, type IdGenerator } from './core/determinism.js';
export {
  incrementVector,
  mergeVectors,
  compareVectors,
  isOrderedBefore,
  cloneVector,
} from './core/version-vector.js';
export {
  detectObjectConflicts,
  determineTitleSubType,
  groupBySubType,
  filterView,
  resolutionView,
  conflictStatistics,
  displayNameForSubType,
  cloneObject,
} from './core/conflict.js';
export { createReplica, type Replica, type ApplyResult, type UpsertObjectInput } from './core/replica.js';
export { createNetwork, type Network, type DeliveryOptions } from './core/network.js';
export {
  createLogicalClock,
  createBaseInstallation,
  createDisconnectedInstallation,
  type LogicalClock,
  type BaseInstallation,
  type DisconnectedInstallation,
} from './core/investigation.js';
export { statesConverged } from './core/converge.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
