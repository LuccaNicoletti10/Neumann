/**
 * ingestion-runtime — typed failures. Callers distinguish quarantine from retry.
 */

export class MappingTransformError extends Error {
  readonly code = 'MAPPING_TRANSFORM' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MappingTransformError';
  }
}

export class IngestionLeaseHeldError extends Error {
  readonly code = 'INGESTION_LEASE_HELD' as const;
  constructor(runId: string) {
    super(`ingestion run ${runId} is leased by another worker`);
    this.name = 'IngestionLeaseHeldError';
  }
}

export class IngestionDeniedError extends Error {
  readonly code = 'INGESTION_DENIED' as const;
  constructor() {
    super('ingestion denied');
    this.name = 'IngestionDeniedError';
  }
}

export class WebhookAuthenticationError extends Error {
  readonly code = 'WEBHOOK_AUTH' as const;
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'WebhookAuthenticationError';
  }
}

export class WebhookTimestampError extends WebhookAuthenticationError {
  constructor(message = 'webhook timestamp expired') {
    super(message);
    this.name = 'WebhookTimestampError';
  }
}

export class WebhookNonceReuseError extends Error {
  readonly code = 'INGESTION_NONCE_REPLAY' as const;
  readonly statusCode = 409;
  readonly errorCode = 'CONFLICT' as const;
  readonly errorName = 'INGESTION_NONCE_REPLAY';
  constructor() {
    super('webhook nonce reused');
    this.name = 'WebhookNonceReuseError';
  }
}

/** Test-only: thrown between ProjectionWriter commit and checkpoint. Never a domain error. */
export class IngestionCrashFailpointError extends Error {
  readonly code = 'INGESTION_CRASH_FAILPOINT' as const;
  constructor() {
    super('ingestion crash failpoint');
    this.name = 'IngestionCrashFailpointError';
  }
}

export class PayloadTooLargeError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
  readonly statusCode = 413;
  constructor(maxBytes: number) {
    super(`webhook body exceeds ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

export class ConnectorUnavailableError extends Error {
  readonly code = 'CONNECTOR_UNAVAILABLE' as const;
  readonly statusCode: number;
  constructor(kind: 'missing' | 'disabled') {
    super(kind === 'disabled' ? 'connector disabled' : 'connector not found');
    this.name = 'ConnectorUnavailableError';
    this.statusCode = kind === 'disabled' ? 403 : 404;
  }
}

export class IngestionEventConflictError extends Error {
  readonly code = 'INGESTION_EVENT_CONFLICT' as const;
  readonly statusCode = 409;
  readonly errorCode = 'CONFLICT' as const;
  readonly errorName = 'INGESTION_EVENT_CONFLICT';
  constructor() {
    super('ingestion event conflict');
    this.name = 'IngestionEventConflictError';
  }
}

export class IngestionVersionConflictError extends Error {
  readonly code = 'INGESTION_VERSION_CONFLICT' as const;
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'IngestionVersionConflictError';
  }
}
