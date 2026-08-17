/**
 * replication — src/index.ts
 */

export { createDeterministicClock, createIdGenerator, createLogicalClock } from './core/determinism.js';
export type { Clock, IdGenerator } from './core/determinism.js';
export { incrementVector, mergeVectors, compareVectors, isOrderedBefore } from './core/vector.js';
export {
  createReplicationSite,
  replicate,
  type AccessUnit,
  type ReplicatedObject,
  type ApplyResult,
  type ApplyStatus,
  type PeerPolicy,
  type ReplicationSite,
} from './core/site.js';
export {
  createExportingSystem,
  createImportingSystem,
  type ExportingSystem,
  type ImportingSystem,
} from './core/incremental.js';
export {
  createOntologyMap,
  ontologyMapDigest,
  mapsCompatible,
  propertyRoundTripStable,
  type OntologyMap,
  type PropertyBase,
} from './core/ontology-map.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
