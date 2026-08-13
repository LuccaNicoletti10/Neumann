/**
 * object-set — src/index.ts
 */

export { evaluateFilter } from './core/filter.js';
export { normalizeFilter } from './core/normalize.js';
export {
  resolveObjectSet,
  loadObjects,
  aggregateObjects,
  aggregateRecords,
  type ObjectSetResolverDeps,
} from './core/resolver.js';
