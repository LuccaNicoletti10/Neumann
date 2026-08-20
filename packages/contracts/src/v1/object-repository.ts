/**
 * contracts — src/v1/object-repository.ts
 * Generic Object / Link persistence — no domain models.
 */

import type { LinkTypeId, ObjectTypeId, OntologyId, OntologyVersionId } from './ontology.js';

export type ObjectRecordId = string;
export type LinkRecordId = string;

/** Generic persisted object instance. */
export interface ObjectRecord {
  id: ObjectRecordId;
  ontologyId: OntologyId;
  ontologyVersionId?: OntologyVersionId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  properties: Record<string, unknown>;
  version: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  /** Provenance / source system label. */
  source?: string;
  provenance?: Record<string, unknown>;
  /** Derived stable URN — not persisted. */
  urn?: string;
}

export interface CreateObjectInput {
  ontologyId: OntologyId;
  ontologyVersionId?: OntologyVersionId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  properties?: Record<string, unknown>;
  source?: string;
  provenance?: Record<string, unknown>;
  /**
   * Optional durable handle. Identity remains ontologyId+objectTypeId+primaryKey.
   * WHY: graph/CLI adapters must not keep a parallel id index.
   */
  id?: ObjectRecordId;
}

export interface UpdateObjectInput {
  properties: Record<string, unknown>;
  /** Merge (default) or replace all properties. */
  mode?: 'merge' | 'replace';
  expectedVersion?: number;
  /**
   * Version the caller is operating under (Action pin, projection batch pin).
   * Validation still uses the version stamped on the record — publishing a new
   * ontology version does not migrate objects. Declaring it here lets a
   * violation name both versions instead of only the undeclared property.
   */
  ontologyVersionId?: OntologyVersionId;
  /**
   * Declared migration target. Re-stamps `record.ontologyVersionId` and is the
   * only way an object changes schema version.
   * WHY explicit: an implicit re-stamp would rewrite history silently.
   */
  migrateToOntologyVersionId?: OntologyVersionId;
  /**
   * Merged into record.provenance. Identity is unchanged.
   * WHY: mapping facade stores dataset/mapping ids here, not in a parallel Map.
   */
  provenance?: Record<string, unknown>;
}

export interface DeleteObjectInput {
  expectedVersion?: number;
}

export interface ListObjectsOptions {
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: { property: string; direction?: 'asc' | 'desc' };
}

/** First-class ontology link instance. */
export interface LinkRecord {
  id: LinkRecordId;
  ontologyId: OntologyId;
  linkTypeId: LinkTypeId;
  sourceObjectTypeId: ObjectTypeId;
  sourcePrimaryKey: string;
  targetObjectTypeId: ObjectTypeId;
  targetPrimaryKey: string;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  /** Explicit unlink. Endpoint soft-delete does NOT cascade here (WORLD HISTORY). */
  deleted?: boolean;
  /** Optional cardinality hint from LinkTypeDef. */
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N';
  source?: string;
  provenance?: Record<string, unknown>;
  principal?: string;
}

export interface CreateLinkInput {
  ontologyId: OntologyId;
  linkTypeId: LinkTypeId;
  sourceObjectTypeId: ObjectTypeId;
  sourcePrimaryKey: string;
  targetObjectTypeId: ObjectTypeId;
  targetPrimaryKey: string;
  cardinality?: LinkRecord['cardinality'];
  source?: string;
  provenance?: Record<string, unknown>;
  principal?: string;
  /** Optional durable handle. Identity remains the endpoint tuple. */
  id?: LinkRecordId;
  /**
   * CAS for revive (deleted row) or active upsert (live row).
   * When set, the write is conditional:
   *   - expectedVersion absent → pure create; a live row is `link already exists`.
   *   - expectedVersion = N on a deleted row → revive if version = N.
   *   - expectedVersion = N on a live row → active upsert: UPDATE provenance/observedAt
   *     WHERE version = N, then version += 1. Concurrent callers: one winner.
   * WHY: revive and active upsert are distinct. expectedVersion is required for
   * the active path so a create cannot silently overwrite a live link.
   */
  expectedVersion?: number;
}

/** Default listFrom/listTo = WORLD NOW (live links + live endpoints). */
export interface ListLinksOptions {
  /** Include links whose source/target object is soft-deleted (WORLD HISTORY). */
  includeDeletedEndpoints?: boolean;
  /** Include explicitly unlinked (deleted=true) rows. */
  includeDeletedLinks?: boolean;
}

/**
 * Durable ObjectRepository — create/get/list/update/delete.
 * Must not depend on Product, Machine, Order, PlanLine, or any domain model.
 *
 * Identity: ontologyId + objectTypeId + primaryKey. `id` is a handle.
 */
export interface ObjectRepository {
  create(input: CreateObjectInput): Promise<ObjectRecord>;
  get(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
  ): Promise<ObjectRecord | undefined>;
  getById(id: ObjectRecordId): Promise<ObjectRecord | undefined>;
  list(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    opts?: ListObjectsOptions,
  ): Promise<ObjectRecord[]>;
  /** All types in one ontology. Used by graph integrity, not HTTP list. */
  listAll(ontologyId: OntologyId, opts?: ListObjectsOptions): Promise<ObjectRecord[]>;
  update(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
    input: UpdateObjectInput,
  ): Promise<ObjectRecord>;
  /**
   * Soft-delete. Returns the durable post-state (RETURNING / in-memory row)
   * or undefined if the object was already absent.
   */
  delete(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
    input?: DeleteObjectInput,
  ): Promise<ObjectRecord | undefined>;
}

export interface DeleteLinkInput {
  /**
   * Optimistic version expected on the link row.
   * WHY: delete_link inside a MutationPlan requires CAS so concurrent deletes
   * by different actions produce a VERSION_CONFLICT rather than a silent no-op.
   * When absent the delete proceeds unconditionally (non-CAS callers only).
   */
  expectedVersion?: number;
}

/**
 * LinkRepository — first-class traversal Object → LinkType → Object(s).
 */
export interface LinkRepository {
  create(input: CreateLinkInput): Promise<LinkRecord>;
  delete(
    ontologyId: OntologyId,
    linkTypeId: LinkTypeId,
    sourceObjectTypeId: ObjectTypeId,
    sourcePrimaryKey: string,
    targetObjectTypeId: ObjectTypeId,
    targetPrimaryKey: string,
    input?: DeleteLinkInput,
  ): Promise<boolean>;
  listFrom(
    ontologyId: OntologyId,
    sourceObjectTypeId: ObjectTypeId,
    sourcePrimaryKey: string,
    linkTypeId?: LinkTypeId,
    opts?: ListLinksOptions,
  ): Promise<LinkRecord[]>;
  listTo(
    ontologyId: OntologyId,
    targetObjectTypeId: ObjectTypeId,
    targetPrimaryKey: string,
    linkTypeId?: LinkTypeId,
    opts?: ListLinksOptions,
  ): Promise<LinkRecord[]>;
  /** All link types in one ontology. Used by graph integrity. */
  listAll(ontologyId: OntologyId, opts?: ListLinksOptions): Promise<LinkRecord[]>;
}

/** Read capability. Query/HTTP public surfaces take this, not the writer. */
export type ObjectReader = Pick<ObjectRepository, 'get' | 'getById' | 'list' | 'listAll'>;
/** Write capability. Actions and ProjectionWriter receive this via UnitOfWork. */
export type ObjectWriter = Pick<ObjectRepository, 'create' | 'update' | 'delete'>;
/** Read capability for traversal. */
export type LinkReader = Pick<LinkRepository, 'listFrom' | 'listTo' | 'listAll'>;
/** Write capability for links. */
export type LinkWriter = Pick<LinkRepository, 'create' | 'delete'>;

/** Stable catalog URN: urn:neumann:<ontology>:<type>:<pk> */
export function urnOf(ontologyId: string, objectTypeId: string, primaryKey: string): string {
  return `urn:neumann:${ontologyId}:${objectTypeId}:${primaryKey}`;
}
