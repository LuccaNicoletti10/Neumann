/**
 * api-errors — Neumann structured API errors.
 *
 * Adapted from OpenFoundry packages/errors/src/api-error.ts (Apache-2.0).
 * Materially modified for Neumann naming and error codes.
 *
 * Copyright 2024 OpenFoundry Contributors — Apache-2.0
 * Copyright contributors to the NEUMANN project
 */

export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE';

const STATUS: Record<ErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

export interface SerializedApiError {
  errorCode: ErrorCode;
  errorName: string;
  errorInstanceId: string;
  message: string;
  parameters: Record<string, unknown>;
  statusCode: number;
  traceId?: string;
}

export class NeumannApiError extends Error {
  readonly errorCode: ErrorCode;
  readonly errorName: string;
  readonly errorInstanceId: string;
  readonly statusCode: number;
  readonly parameters: Record<string, unknown>;
  readonly traceId?: string;

  constructor(options: {
    errorCode: ErrorCode;
    errorName: string;
    message: string;
    errorInstanceId?: string;
    statusCode?: number;
    parameters?: Record<string, unknown>;
    traceId?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'NeumannApiError';
    this.errorCode = options.errorCode;
    this.errorName = options.errorName;
    this.errorInstanceId = options.errorInstanceId ?? crypto.randomUUID();
    this.statusCode = options.statusCode ?? STATUS[options.errorCode];
    this.parameters = options.parameters ?? {};
    this.traceId = options.traceId;
  }

  toJSON(): SerializedApiError {
    return {
      errorCode: this.errorCode,
      errorName: this.errorName,
      errorInstanceId: this.errorInstanceId,
      message: this.message,
      parameters: this.parameters,
      statusCode: this.statusCode,
      traceId: this.traceId,
    };
  }
}

export function versionConflict(params: Record<string, unknown> = {}): NeumannApiError {
  return new NeumannApiError({
    errorCode: 'VERSION_CONFLICT',
    errorName: 'VersionConflict',
    message: 'Optimistic concurrency conflict',
    parameters: params,
  });
}

export function notFound(errorName: string, message: string, parameters: Record<string, unknown> = {}): NeumannApiError {
  return new NeumannApiError({ errorCode: 'NOT_FOUND', errorName, message, parameters });
}

export function invalidArgument(message: string, parameters: Record<string, unknown> = {}): NeumannApiError {
  return new NeumannApiError({
    errorCode: 'INVALID_ARGUMENT',
    errorName: 'InvalidArgument',
    message,
    parameters,
  });
}

export function validationError(message: string, parameters: Record<string, unknown> = {}): NeumannApiError {
  return new NeumannApiError({
    errorCode: 'VALIDATION_ERROR',
    errorName: 'ValidationError',
    message,
    parameters,
  });
}

export function unauthenticated(message = 'Authentication required'): NeumannApiError {
  return new NeumannApiError({
    errorCode: 'UNAUTHENTICATED',
    errorName: 'Unauthenticated',
    message,
  });
}

export function permissionDenied(message = 'Permission denied', parameters: Record<string, unknown> = {}): NeumannApiError {
  return new NeumannApiError({
    errorCode: 'PERMISSION_DENIED',
    errorName: 'PermissionDenied',
    message,
    parameters,
  });
}
