/**
 * history-preserving-pipeline — src/index.ts
 * API pública (Passo 8).
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/hash.js';
export { MemoryBlobStore, FsBlobStore } from './core/blob-store.js';
export type { BlobStore } from './core/blob-store.js';
export { createManifestStore, ManifestError } from './core/manifest.js';
export type { ManifestStore } from './core/manifest.js';
export {
  createTransactionService,
  TransactionError,
} from './core/transaction.js';
export type {
  TransactionService,
  TransactionRecord,
  StartTxOptions,
} from './core/transaction.js';
export { createBuildService, BuildError } from './core/build.js';
export type { BuildService, TraceNode } from './core/build.js';
export { compareVersions, structuralDiff } from './core/compare.js';
export { createDatasetStoreAdapter } from './core/lake.js';
export {
  createHistoryPreservingPipeline,
  createDataLake,
} from './core/system.js';
export type {
  HistoryPreservingPipeline,
  CreatePipelineOptions,
} from './core/system.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
