/**
 * federation — src/index.ts
 */

export {
  createDeterministicClock,
  createIdGenerator,
  addMs,
  isAfter,
  type Clock,
  type IdGenerator,
} from './core/determinism.js';
export { planFederation } from './core/planner.js';
export { applyPushdown, matchPredicate, isPushedDown } from './core/pushdown.js';
export { createDefaultFederatedScript } from './core/script.js';
export {
  canReadAcl,
  principalKeys,
  aggregateAcl,
  redactFields,
  redactTemporaryObject,
} from './core/acl.js';
export {
  createMemoryFederatedConnector,
  type MemoryFederatedConnector,
  type MemoryFederatedRecord,
} from './core/memory-source.js';
export {
  createFederationEngine,
  type FederationEngine,
  type FederatedSourceBinding,
  type CreateFederationEngineOptions,
} from './core/engine.js';
export {
  temporaryToSearchDocument,
  asFederationPrincipal,
  createFederateAdapter,
} from './core/search-adapter.js';
export { seedFederation, FED_SSN_SECRET } from './core/seed.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
