/**
 * function-registry — typed FunctionRuntime failures.
 */

export class FunctionIdempotencyConflictError extends Error {
  readonly code = 'FUNCTION_IDEMPOTENCY_CONFLICT' as const;
  readonly statusCode = 409;
  readonly errorName = 'FUNCTION_IDEMPOTENCY_CONFLICT';
  constructor() {
    super('function idempotency conflict');
    this.name = 'FunctionIdempotencyConflictError';
  }
}

export class FunctionDeniedError extends Error {
  readonly code = 'DENIED' as const;
  constructor() {
    super('function denied');
    this.name = 'FunctionDeniedError';
  }
}

export class FunctionLeaseHeldError extends Error {
  readonly code = 'FUNCTION_LEASE_HELD' as const;
  constructor(executionId: string) {
    super(`function execution ${executionId} is leased`);
    this.name = 'FunctionLeaseHeldError';
  }
}

export class FunctionArtifactHashMismatchError extends Error {
  readonly code = 'ARTIFACT_HASH_MISMATCH' as const;
  constructor() {
    super('function artifact bytes diverged from hash');
    this.name = 'FunctionArtifactHashMismatchError';
  }
}

export class FunctionTerminalError extends Error {
  readonly code = 'FUNCTION_TERMINAL' as const;
  constructor() {
    super('function execution is terminal');
    this.name = 'FunctionTerminalError';
  }
}

export class FunctionInvalidParametersError extends Error {
  readonly code = 'INVALID_PARAMETERS' as const;
  readonly statusCode = 400;
  constructor() {
    super('function parameters invalid');
    this.name = 'FunctionInvalidParametersError';
  }
}

export class FunctionSnapshotUnavailableError extends Error {
  readonly code = 'FUNCTION_SNAPSHOT_UNAVAILABLE' as const;
  readonly statusCode = 409;
  readonly errorName = 'FUNCTION_SNAPSHOT_UNAVAILABLE';
  constructor() {
    super('function snapshot unavailable at readAsOf');
    this.name = 'FunctionSnapshotUnavailableError';
  }
}

export class FunctionPublishError extends Error {
  readonly code = 'FUNCTION_PUBLISH' as const;
  constructor(message: string) {
    super(message);
    this.name = 'FunctionPublishError';
  }
}

export class FunctionCrashFailpointError extends Error {
  constructor() {
    super('function crash after action before result');
    this.name = 'FunctionCrashFailpointError';
  }
}
