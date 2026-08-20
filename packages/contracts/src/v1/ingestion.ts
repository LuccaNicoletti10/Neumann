/**
 * contracts — src/v1/ingestion.ts
 * Connector envelopes and the IngestionRuntime surface (ADR-0016).
 *
 * MappingVersion in object-platform.ts remains the catalog record.
 * MappingDefinition is that record's transform; IngestionMappingPin is the
 * snapshot a run carries so processing never re-reads latest.
 */

import type { CanonicalEvent } from './canonical-event.js';
import type {
  LinkMapping,
  MappingId,
  MappingVersion,
  MappingVersionId,
  PropertyMapping,
  SourceField,
} from './object-platform.js';
import type { OntologyId, OntologyVersionId } from './ontology.js';
import type { PrincipalId } from './policy.js';

export type IngestionRunId = string;
export type IngestionQuarantineId = string;

export type IngestionRunKind = 'pull' | 'webhook' | 'retry';
export type IngestionRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'quarantined';

/**
 * Envelope a connector produces. No ObjectType, no SQL, no policy.
 * CanonicalEvent is the frozen on-the-wire form; this is the runtime subset.
 */
export interface RawEnvelope {
  connectorId: string;
  source: string;
  sourceEventId: string;
  sourceSchemaVersion?: string;
  occurredAt: string;
  payload: unknown;
  metadata: Record<string, string>;
}

export interface ConnectorPage {
  envelopes: readonly RawEnvelope[];
  nextCursor?: string;
  completed: boolean;
}

/**
 * Declarative transform. Identical fields to MappingVersion; not a second mapping type.
 */
export type MappingDefinition = Pick<
  MappingVersion,
  'objectTypeId' | 'primaryKeyFields' | 'propertyMappings' | 'linkMappings'
>;

/**
 * Pin stored on an IngestionRun. Identity fields match the prompt's MappingVersion
 * shape without replacing the catalog record.
 */
export interface IngestionMappingPin {
  mappingId: MappingId;
  mappingVersionId: MappingVersionId;
  version: number;
  hash: string;
  ontologyId: OntologyId;
  ontologyVersionId: OntologyVersionId;
  sourceSchemaVersion?: string;
  definition: MappingDefinition;
}

export type ConnectorKind = 'csv' | 'http' | 'webhook';

/**
 * Durable connector catalog record. `config` never contains a secret;
 * HMAC material is resolved through `secretRef`.
 */
export interface ConnectorRegistration {
  connectorId: string;
  kind: ConnectorKind;
  enabled: boolean;
  config: Record<string, unknown>;
  secretRef?: string;
  servicePrincipal: PrincipalId;
  mappingId: MappingId;
  ontologyId: OntologyId;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorRegistrationRepository {
  get(connectorId: string): Promise<ConnectorRegistration | undefined>;
  put(
    registration: ConnectorRegistration,
    expectedVersion?: number,
  ): Promise<ConnectorRegistration>;
  list(): Promise<readonly ConnectorRegistration[]>;
}

export interface PublishMappingInput {
  mappingId: MappingId;
  ontologyId: OntologyId;
  ontologyVersionId: OntologyVersionId;
  datasetId: string;
  objectTypeId: string;
  primaryKeyFields: SourceField[];
  propertyMappings: PropertyMapping[];
  linkMappings?: LinkMapping[];
  sourceSchemaVersion?: string;
  createdBy: string;
}

/**
 * Append-only published MappingVersion. Identical content returns the existing row.
 * This is the ingest catalog — not a twin of ObjectPlatform Maps.
 */
export interface MappingVersionRepository {
  publish(input: PublishMappingInput): Promise<MappingVersion>;
  getVersion(id: MappingVersionId): Promise<MappingVersion | undefined>;
  getLatest(mappingId: MappingId): Promise<MappingVersion | undefined>;
}

export interface EnqueueWebhookInput {
  connectorId: string;
  /** Required for the in-process envelope path. HTTP resolves this from the connector catalog. */
  mappingId?: MappingId;
  ontologyId?: OntologyId;
  principal?: PrincipalId;
  /** Trusted in-process envelope. HMAC is not applied. */
  envelope?: RawEnvelope;
  /** Push path: raw body + signature verified with the injected secret. */
  rawBody?: string;
  signature?: string;
  /** Unix seconds or ISO-8601. Required with `rawBody`. */
  timestamp?: string;
  nonce?: string;
  mappingVersionId?: MappingVersionId;
}

/** HTTP 202 body. `enqueueWebhook` still returns the run plus these fields. */
export interface IngestionWebhookResult extends IngestionRun {
  sourceEventId: string;
  replayed: boolean;
}

export interface StartPullInput {
  connectorId: string;
  mappingId: MappingId;
  ontologyId: OntologyId;
  principal: PrincipalId;
  mappingVersionId?: MappingVersionId;
  objectName?: string;
}

export interface RetryQuarantineInput {
  quarantineId: IngestionQuarantineId;
  principal: PrincipalId;
}

export interface IngestionRun {
  id: IngestionRunId;
  kind: IngestionRunKind;
  status: IngestionRunStatus;
  connectorId: string;
  principal: PrincipalId;
  pin: IngestionMappingPin;
  cursor?: string;
  objectName: string;
  processedCount: number;
  quarantinedCount: number;
  workerId?: string;
  leaseUntil?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionQuarantineEntry {
  id: IngestionQuarantineId;
  runId: IngestionRunId;
  envelope: RawEnvelope;
  reason: string;
  attempts: number;
  pin: IngestionMappingPin;
  createdAt: string;
}

/**
 * Deep module. Callers do not resolve connectors, pin mappings, or write objects.
 */
export interface IngestionRuntime {
  enqueueWebhook(input: EnqueueWebhookInput): Promise<IngestionWebhookResult>;
  startPull(input: StartPullInput): Promise<IngestionRun>;
  runOnce(runId: IngestionRunId): Promise<IngestionRun>;
  getRun(runId: IngestionRunId): Promise<IngestionRun | undefined>;
  retryQuarantined(input: RetryQuarantineInput): Promise<IngestionRun>;
}

export function definitionOf(mv: MappingVersion): MappingDefinition {
  return {
    objectTypeId: mv.objectTypeId,
    primaryKeyFields: [...mv.primaryKeyFields] as SourceField[],
    propertyMappings: mv.propertyMappings.map((p: PropertyMapping) => ({ ...p })),
    linkMappings: mv.linkMappings.map((l: LinkMapping) => ({ ...l })),
  };
}

export function pinFromMappingVersion(
  mv: MappingVersion,
  ontologyId: OntologyId,
  sourceSchemaVersion?: string,
): IngestionMappingPin {
  return {
    mappingId: mv.mappingId,
    mappingVersionId: mv.id,
    version: mv.versionNumber,
    hash: mv.contentHash,
    ontologyId,
    ontologyVersionId: mv.ontologyVersionId,
    sourceSchemaVersion,
    definition: definitionOf(mv),
  };
}

export function envelopeFromCanonical(event: CanonicalEvent): RawEnvelope {
  return {
    connectorId: event.connector_id,
    source: event.source_system,
    sourceEventId: event.event_id,
    sourceSchemaVersion: event.schema_version,
    occurredAt: event.occurred_at,
    payload: event.payload,
    metadata: {
      source_object: event.source_object,
      source_primary_key: event.source_primary_key,
      checkpoint: event.checkpoint,
      principal: event.principal,
    },
  };
}

export function assertRawEnvelope(value: unknown): asserts value is RawEnvelope {
  if (value === null || typeof value !== 'object') {
    throw new Error('RawEnvelope: esperado objeto');
  }
  const e = value as Record<string, unknown>;
  for (const key of ['connectorId', 'source', 'sourceEventId', 'occurredAt'] as const) {
    if (typeof e[key] !== 'string' || e[key].length === 0) {
      throw new Error(`RawEnvelope: ${key} obrigatório`);
    }
  }
  if (e.metadata === null || typeof e.metadata !== 'object' || Array.isArray(e.metadata)) {
    throw new Error('RawEnvelope: metadata deve ser Record<string, string>');
  }
  const metadata = e.metadata as Record<string, unknown>;
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v !== 'string') {
      throw new Error(`RawEnvelope: metadata.${k} deve ser string`);
    }
  }
}

export function assertMappingDefinition(def: MappingDefinition): void {
  if (!def.objectTypeId) throw new Error('MappingDefinition: objectTypeId obrigatório');
  if (!Array.isArray(def.primaryKeyFields) || def.primaryKeyFields.length === 0) {
    throw new Error('MappingDefinition: primaryKeyFields[] obrigatório');
  }
  if (!Array.isArray(def.propertyMappings)) {
    throw new Error('MappingDefinition: propertyMappings[] obrigatório');
  }
  if (!Array.isArray(def.linkMappings)) {
    throw new Error('MappingDefinition: linkMappings[] obrigatório');
  }
}

export function assertIngestionMappingPin(value: unknown): asserts value is IngestionMappingPin {
  if (value === null || typeof value !== 'object') {
    throw new Error('IngestionMappingPin: esperado objeto');
  }
  const pin = value as Record<string, unknown>;
  for (const key of [
    'mappingId',
    'mappingVersionId',
    'hash',
    'ontologyId',
    'ontologyVersionId',
  ] as const) {
    if (typeof pin[key] !== 'string' || pin[key].length === 0) {
      throw new Error(`IngestionMappingPin: ${key} obrigatório`);
    }
  }
  if (typeof pin.version !== 'number' || !Number.isInteger(pin.version) || pin.version < 1) {
    throw new Error('IngestionMappingPin: version deve ser inteiro ≥ 1');
  }
  if (pin.definition === null || typeof pin.definition !== 'object') {
    throw new Error('IngestionMappingPin: definition obrigatória');
  }
  assertMappingDefinition(pin.definition as MappingDefinition);
}
