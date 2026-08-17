/**
 * entity-resolution — src/index.ts
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/normalize.js';
export * from './core/blocking.js';
export * from './core/scoring.js';
export * from './core/cluster.js';
export * from './core/cluster-score.js';
export * from './core/fingerprint.js';
export * from './core/pair-key.js';
export * from './core/gold-corpus.js';
export * from './core/metrics.js';
export * from './core/feedback.js';
export * from './core/review-queue.js';
export * from './core/ledger.js';
export * from './core/pg-ledger.js';
export * from './core/engine.js';
export { runCommandLine, runDemo, runAuditDemo, runGoldDemo } from './cli.js';
export type { CliDeps } from './cli.js';
