/**
 * ingestion-runtime — public surface (ADR-0016 / ADR-0017).
 */

export { createIngestionRuntime, type CreateIngestionRuntimeOptions, type Clock, type IdGenerator } from './core/runtime.js';
export type { IngestionRuntime } from 'contracts';
export {
  catalogFromPlatform,
  catalogFromRepository,
  createMemoryMappingCatalog,
  type MappingCatalog,
} from './core/mapping-catalog.js';
export {
  createConnectorRegistry,
  createDurableConnectorRegistry,
  sourceFromConnectorV2,
  sourceFromEnvelopes,
  type ConnectorRegistry,
  type EnvelopeSource,
  type SourceFactory,
} from './core/envelope-source.js';
export { sourceFromRegistration } from './core/source-from-registration.js';
export { createMemoryIngestionStore, type IngestionStore } from './core/ingestion-store.js';
export { createPgIngestionStore } from './core/pg-ingestion-store.js';
export { createPgCheckpointStore } from './core/pg-checkpoint.js';
export { createMemoryCheckpointStore } from 'connector-sdk';
export {
  createMemorySecretResolver,
  webhookSecretKey,
  webhookSignedPayload,
  verifyHmacSha256,
  type SecretResolver,
} from './core/authenticate-push.js';
export {
  MappingTransformError,
  IngestionLeaseHeldError,
  IngestionDeniedError,
  WebhookAuthenticationError,
  WebhookTimestampError,
  WebhookNonceReuseError,
  PayloadTooLargeError,
  ConnectorUnavailableError,
  IngestionEventConflictError,
  IngestionVersionConflictError,
  IngestionCrashFailpointError,
} from './core/errors.js';
export {
  SENSITIVE_CONFIG_KEYS,
  sanitizeIngestionLog,
  redactLogValue,
  noopIngestionLogger,
  type IngestionLogger,
  type IngestionLogEvent,
} from './core/log-redaction.js';
export { envelopeToEffects, primaryKeyOf } from './core/mapping-transform.js';
export {
  createMemoryConnectorRegistrationRepository,
  assertConfigHasNoSecret,
} from './core/connector-catalog.js';
export { createPgConnectorRegistrationRepository } from './core/pg-connector-catalog.js';
export { createMemoryMappingVersionRepository } from './core/mapping-version-repository.js';
export { createPgMappingVersionRepository } from './core/pg-mapping-version-repository.js';
export { createIngestionWorker, type IngestionWorker, type CreateIngestionWorkerOptions } from './core/worker.js';
