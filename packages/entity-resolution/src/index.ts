/**
 * entity-resolution — src/index.ts
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/normalize.js';
export * from './core/blocking.js';
export * from './core/scoring.js';
export * from './core/cluster.js';
export * from './core/engine.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
