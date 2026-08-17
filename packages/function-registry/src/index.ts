/**
 * function-registry — src/index.ts
 */

export { createFunctionRegistry, registerBuiltins } from './core/registry.js';
export type { CreateFunctionRegistryOptions } from './core/registry.js';
export { invokePure, snapshotObjects } from './core/purity.js';
export { scoreRecord, aggregateMetrics, deriveFlags } from './core/builtins.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
