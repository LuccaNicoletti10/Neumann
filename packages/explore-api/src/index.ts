/**
 * explore-api — src/index.ts
 */

export {
  createDeterministicClock,
  createIdGenerator,
  type Clock,
  type IdGenerator,
} from './core/determinism.js';
export { objectKey, neighborsOf, type ExploreCatalog } from './core/catalog.js';
export { executeGraphPattern, type ExecutePatternOptions } from './core/pattern.js';
export {
  transformTokens,
  buildInvestigationIndex,
  singleLevelSearch,
  twoLevelSearch,
  type InvestigationIndex,
  type IndexValue,
} from './core/investigation.js';
export {
  computeObjectScores,
  updateWeight,
  clampScore,
  linearScale,
  type RegisteredMetric,
  type MetricScoreFn,
} from './core/scorer.js';
export {
  createBindingStore,
  bindSlot,
  visibleProperties,
  suggestBindings,
  resolveExpression,
  evaluateExpression,
  setExpression,
  projectObject,
  type BindingStore,
} from './core/bindings.js';
export { catalogFromRepos } from './core/from-repos.js';
export { seedExploreCatalog, EXPLORE_SECRET } from './core/seed.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
