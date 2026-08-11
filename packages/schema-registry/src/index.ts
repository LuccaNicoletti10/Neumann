/**
 * schema-registry — src/index.ts
 * API pública do pacote.
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/typesystem.js';
export * from './core/drift.js';
export * from './core/registry.js';
export * from './core/discover.js';
export * from './core/mapping.js';
export { createServer, startServer, MAX_BODY } from './server/index.js';
export type { ServerDeps, StartedServer } from './server/index.js';
export { runCommandLine } from './cli.js';
export type { CliDeps } from './cli.js';
