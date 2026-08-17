/**
 * knowledge-graph — src/index.ts
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/store.js';
export * from './core/graph-query.js';
export * from './core/redact.js';
export { runCommandLine, runDemo, runRedactDemo } from './cli.js';
export type { CliDeps } from './cli.js';
