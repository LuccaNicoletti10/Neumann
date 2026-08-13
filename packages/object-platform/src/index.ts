/**
 * object-platform — src/index.ts
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/hash.js';
export * from './core/errors.js';
export * from './core/platform.js';
export * from './core/object-repository.js';
export * from './core/link-repository.js';
export * from './core/pg-object-repository.js';
export * from './core/pg-link-repository.js';
export * from './core/pg-sql.js';
export * from './core/object-history-store.js';
export * from './core/governed-object-repository.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
