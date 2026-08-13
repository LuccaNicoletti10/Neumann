/**
 * object-set — src/index.ts
 */

export { evaluateFilter } from './core/filter.js';
export { normalizeFilter } from './core/normalize.js';
export {
  coerceValue,
  coerceFilter,
  coerceObjectSet,
  baseTypeOf,
  propertyLookupFromTypes,
  propertyLookupFromOntology,
  invalidFilterValue,
  type PropertyTypeLookup,
  type CoerceMode,
} from './core/coerce.js';
export {
  compileFilter,
  compileObjectSet,
  compileLoad,
  compileResolve,
  compileAggregate,
  createCompileCtx,
  queryFingerprint,
  type CompileCtx,
  type SqlFragment,
  type CompileLoadOpts,
} from './core/compile-sql.js';
export {
  resolveObjectSet,
  loadObjects,
  aggregateObjects,
  aggregateRecords,
  type ObjectSetResolverDeps,
} from './core/resolver.js';
export {
  createPgObjectSetResolver,
  resolveObjectSetPg,
  loadObjectsPg,
  aggregateObjectsPg,
  type PgObjectSetResolverDeps,
} from './core/resolver-pg.js';
