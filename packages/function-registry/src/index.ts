/**
 * function-registry — public surface (ADR-0019).
 * createFunctionRegistry remains CLI/demo only. Production is FunctionRuntime.
 */

export { createFunctionRegistry, registerBuiltins } from './core/registry.js';
export type { CreateFunctionRegistryOptions } from './core/registry.js';
export { invokePure, snapshotObjects } from './core/purity.js';
export { scoreRecord, aggregateMetrics, deriveFlags } from './core/builtins.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';

export { hashArtifactBytes, artifactBytesFromSource, artifactSource } from './core/artifact-hash.js';
export { assertPublishableArtifact } from './core/artifact-scan.js';
export { createMemoryFunctionArtifactStore } from './core/artifact-store.js';
export { createPgFunctionArtifactStore } from './core/pg-artifact-store.js';
export { createMemoryFunctionExecutionStore } from './core/execution-store.js';
export { createPgFunctionExecutionStore } from './core/pg-execution-store.js';
export { createFunctionDefinitionResolver } from './core/resolver.js';
export {
  createFunctionRuntime,
  type CreateFunctionRuntimeOptions,
  type FunctionObjectReader,
} from './core/runtime.js';
export { createFunctionWorker, type FunctionWorker, type CreateFunctionWorkerOptions } from './core/worker.js';
export { derivedActionIdempotencyKey } from './core/action-invoker.js';
export { runFunctionArtifact, classifyFunctionSandboxFailure } from './core/sandbox-runner.js';
export {
  SCORE_RECORD_SOURCE,
  AGGREGATE_METRICS_SOURCE,
  DERIVE_FLAGS_SOURCE,
} from './core/builtin-artifacts.js';
export {
  FunctionIdempotencyConflictError,
  FunctionDeniedError,
  FunctionLeaseHeldError,
  FunctionArtifactHashMismatchError,
  FunctionTerminalError,
  FunctionInvalidParametersError,
  FunctionSnapshotUnavailableError,
  FunctionPublishError,
  FunctionCrashFailpointError,
} from './core/errors.js';
export { functionLogAllowed, redactFunctionLog, type FunctionLogEvent } from './core/log-redaction.js';
