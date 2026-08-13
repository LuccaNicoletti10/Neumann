/**
 * ontology-registry — src/index.ts
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/hash.js';
export * from './core/registry.js';
export * from './core/pg-registry.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
