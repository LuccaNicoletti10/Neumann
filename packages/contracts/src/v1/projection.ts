/**
 * ProjectionWriter — ingestion port for external sources (connectors / ERP).
 *
 * Not a business API. UI/LLM/humans mutate through ActionExecutor.
 * Identity is sourceEventId per source+ontology; concurrency is expectedVersion.
 */

import type { LinkRecord, ObjectRecord } from './object-repository.js';
import type { LinkTypeId, ObjectTypeId, OntologyId, OntologyVersionId } from './ontology.js';
import type { PrincipalId } from './policy.js';

export type ProjectionOperation =
  | 'project_object'
  | 'delete_object'
  | 'project_link'
  | 'delete_link'
  | 'migrate_object';

export type ProjectionStatus = 'applied' | 'replayed';

export interface ProjectObjectCommand {
  ontologyId: OntologyId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  properties: Record<string, unknown>;
  source: string;
  sourceEventId: string;
  observedAt?: string;
  principal: PrincipalId;
  expectedVersion?: number;
  provenance?: Record<string, unknown>;
}

export interface DeleteProjectedObjectCommand {
  ontologyId: OntologyId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  source: string;
  sourceEventId: string;
  observedAt?: string;
  principal: PrincipalId;
  expectedVersion?: number;
}

export interface ProjectLinkCommand {
  ontologyId: OntologyId;
  linkTypeId: LinkTypeId;
  sourceObjectTypeId: ObjectTypeId;
  sourcePrimaryKey: string;
  targetObjectTypeId: ObjectTypeId;
  targetPrimaryKey: string;
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N';
  source: string;
  sourceEventId: string;
  observedAt?: string;
  principal: PrincipalId;
  provenance?: Record<string, unknown>;
}

export interface DeleteProjectedLinkCommand {
  ontologyId: OntologyId;
  /** CAS: expected version of the link row. When provided, conflicts if version differs. */
  expectedVersion?: number;
  linkTypeId: LinkTypeId;
  sourceObjectTypeId: ObjectTypeId;
  sourcePrimaryKey: string;
  targetObjectTypeId: ObjectTypeId;
  targetPrimaryKey: string;
  source: string;
  sourceEventId: string;
  observedAt?: string;
  principal: PrincipalId;
}

/**
 * Declared migration of one object between OntologyVersions.
 *
 * WHY a command and not a repository write: changing the version that governs an
 * object is a decision, so it must be authorized, transactional, idempotent and
 * auditable exactly like any other mutation.
 */
export interface MigrateObjectCommand {
  ontologyId: OntologyId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  /** Version currently stamped on the object. Must match, or the call conflicts. */
  fromVersionId: OntologyVersionId;
  toVersionId: OntologyVersionId;
  /** CAS on the object row. Required: a migration never overwrites blindly. */
  expectedObjectVersion: number;
  /** Full property set valid under `toVersionId`. */
  transformedProperties: Record<string, unknown>;
  principal: PrincipalId;
  /** Replay identity. Same key + same payload replays; different payload conflicts. */
  idempotencyKey: string;
  observedAt?: string;
  provenance?: Record<string, unknown>;
}

export interface ProjectionResult {
  status: ProjectionStatus;
  operation: ProjectionOperation;
  source: string;
  sourceEventId: string;
  ontologyId: OntologyId;
  object?: ObjectRecord;
  link?: LinkRecord;
  deleted?: boolean;
}

export type ProjectionEffect =
  | { kind: 'project_object'; cmd: ProjectObjectCommand }
  | { kind: 'delete_object'; cmd: DeleteProjectedObjectCommand }
  | { kind: 'project_link'; cmd: ProjectLinkCommand }
  | { kind: 'delete_link'; cmd: DeleteProjectedLinkCommand };

export interface ProjectionBatchCommand {
  /** Connector / source system name. Shared across all effects. */
  source: string;
  ontologyId: OntologyId;
  /**
   * OntologyVersion pinned for the whole batch (ADR-0016).
   * Absent → latest resolved once at batch start, never per effect.
   */
  ontologyVersionId?: OntologyVersionId;
  /** Single identity for all effects in this batch. */
  sourceEventId: string;
  principal: PrincipalId;
  observedAt?: string;
  provenance?: Record<string, unknown>;
  /** Ordered list of effects; order is deterministic and part of the hash. */
  effects: ProjectionEffect[];
}

export interface ProjectionBatchResult {
  status: ProjectionStatus;
  /** One result per effect, in the same order as effects[]. */
  results: ProjectionResult[];
}

/**
 * Deep module: authorize → validate → dedupe → transaction →
 * object/link + history + event + outbox + ledger.
 *
 * Invariants:
 * - sourceEventId is unique per source+ontology.
 * - Same key + same payload replays the prior result (no extra effects).
 * - Same key + different payload is a conflict (no extra effects).
 * - Deny and stale version write nothing.
 * - Throw after a repository write rolls back ledger, objects, events, outbox.
 *
 * projectBatch: one sourceEventId = one transaction.
 * All effects apply or none apply (batch is the unit of work).
 * Singular methods delegate to projectBatch with a single effect.
 */
export interface ProjectionWriter {
  projectObject(cmd: ProjectObjectCommand): Promise<ProjectionResult>;
  deleteProjectedObject(cmd: DeleteProjectedObjectCommand): Promise<ProjectionResult>;
  projectLink(cmd: ProjectLinkCommand): Promise<ProjectionResult>;
  deleteProjectedLink(cmd: DeleteProjectedLinkCommand): Promise<ProjectionResult>;
  /**
   * Apply multiple effects atomically under one sourceEventId.
   * WHY: one source event may create one object and multiple links. Splitting
   * into separate calls would race and produce partial state on failure.
   */
  projectBatch(cmd: ProjectionBatchCommand): Promise<ProjectionBatchResult>;
  /**
   * Move one object from `fromVersionId` to `toVersionId` with an explicit
   * transformation. Never implicit, never batched with unrelated effects.
   */
  migrateObject(cmd: MigrateObjectCommand): Promise<ProjectionResult>;
}
