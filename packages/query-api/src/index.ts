/**
 * query-api — src/index.ts
 */

export {
  createDeterministicClock,
  createIdGenerator,
  percentile,
  freshnessLagMs,
  type Clock,
  type IdGenerator,
} from './core/determinism.js';
export { tokenize, contentTokens } from './core/tokenize.js';
export { canViewDocument, visibleProperties, hasAcl } from './core/acl.js';
export { matchesFilter, bindFilterParams } from './core/filter.js';
export { generateSearchTemplate, applyTemplate } from './core/templates.js';
export { parseNaturalQuery } from './core/nl-parse.js';
export {
  createQueryEngine,
  type QueryEngine,
  type CreateQueryEngineOptions,
  type FederateFn,
} from './core/engine.js';
export { keyPhrases } from './core/key-phrases.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
