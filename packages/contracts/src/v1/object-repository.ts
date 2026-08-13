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
}

export interface CreateObjectInput {
  ontologyId: OntologyId;
  ontologyVersionId?: OntologyVersionId;
  objectTypeId: ObjectTypeId;
  primaryKey: string;
  properties?: Record<string, unknown>;
  source?: string;
  provenance?: Record<string, unknown>;
}

export interface UpdateObjectInput {
  properties: Record<string, unknown>;
  /** Merge (default) or replace all properties. */
  mode?: 'merge' | 'replace';
  expectedVersion?: number;
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
 */
export interface ObjectRepository {
  create(input: CreateObjectInput): Promise<ObjectRecord> | ObjectRecord;
  get(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
  ): Promise<ObjectRecord | undefined> | ObjectRecord | undefined;
  getById(id: ObjectRecordId): Promise<ObjectRecord | undefined> | ObjectRecord | undefined;
  list(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    opts?: ListObjectsOptions,
  ): Promise<ObjectRecord[]> | ObjectRecord[];
  update(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
    input: UpdateObjectInput,
  ): Promise<ObjectRecord> | ObjectRecord;
  /**
   * Soft-delete. Returns the durable post-state (RETURNING / in-memory row)
   * or undefined if the object was already absent.
   */
  delete(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
    input?: DeleteObjectInput,
  ): Promise<ObjectRecord | undefined> | ObjectRecord | undefined;
}

/**
 * LinkRepository — first-class traversal Object → LinkType → Object(s).
 */
export interface LinkRepository {
  create(input: CreateLinkInput): Promise<LinkRecord> | LinkRecord;
  delete(
    ontologyId: OntologyId,
    linkTypeId: LinkTypeId,
    sourceObjectTypeId: ObjectTypeId,
    sourcePrimaryKey: string,
    targetObjectTypeId: ObjectTypeId,
    targetPrimaryKey: string,
  ): Promise<boolean> | boolean;
  listFrom(
    ontologyId: OntologyId,
    sourceObjectTypeId: ObjectTypeId,
    sourcePrimaryKey: string,
    linkTypeId?: LinkTypeId,
    opts?: ListLinksOptions,
  ): Promise<LinkRecord[]> | LinkRecord[];
  listTo(
    ontologyId: OntologyId,
    targetObjectTypeId: ObjectTypeId,
    targetPrimaryKey: string,
    linkTypeId?: LinkTypeId,
    opts?: ListLinksOptions,
  ): Promise<LinkRecord[]> | LinkRecord[];
}
