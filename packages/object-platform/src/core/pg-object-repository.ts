/**
 * object-platform — src/core/pg-object-repository.ts
 * PostgreSQL ObjectRepository (durable). Requires injectable SqlClient.
 *
 * Schema: infra/sql/0002_objects_platform.sql
 */

import type {
  CreateObjectInput,
  ListObjectsOptions,
  ObjectRecord,
  ObjectRepository,
  OntologyId,
  ObjectTypeId,
  UpdateObjectInput,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import type { Clock, IdGenerator } from './types.js';

/** Minimal SQL client (same pattern as connector-postgres / event-bus). */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface CreatePgObjectRepositoryOptions {
  sql: SqlClient;
  clock?: Clock;
  nextId?: IdGenerator;
}

function rowToRecord(row: Record<string, unknown>): ObjectRecord {
  return {
    id: String(row.id),
    ontologyId: String(row.ontology_id),
    ontologyVersionId: row.ontology_version_id
      ? String(row.ontology_version_id)
      : undefined,
    objectTypeId: String(row.object_type_id),
    primaryKey: String(row.primary_key),
    properties: (row.properties as Record<string, unknown>) ?? {},
    version: Number(row.version),
    deleted: Boolean(row.deleted),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    source: row.source != null ? String(row.source) : undefined,
    provenance: (row.provenance as Record<string, unknown>) ?? undefined,
  };
}

export function createPgObjectRepository(
  opts: CreatePgObjectRepositoryOptions,
): ObjectRepository {
  const { sql } = opts;
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();

  return {
    async create(input: CreateObjectInput): Promise<ObjectRecord> {
      const id = nextId('obj');
      const now = clock();
      const result = await sql.query(
        `INSERT INTO platform_objects (
           id, ontology_id, ontology_version_id, object_type_id, primary_key,
           properties, version, deleted, source, provenance, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,1,false,$7,$8::jsonb,$9,$9)
         RETURNING *`,
        [
          id,
          input.ontologyId,
          input.ontologyVersionId ?? null,
          input.objectTypeId,
          input.primaryKey,
          JSON.stringify(input.properties ?? {}),
          input.source ?? null,
          input.provenance ? JSON.stringify(input.provenance) : null,
          now,
        ],
      );
      return rowToRecord(result.rows[0] as Record<string, unknown>);
    },

    async get(ontologyId, objectTypeId, primaryKey) {
      const result = await sql.query(
        `SELECT * FROM platform_objects
         WHERE ontology_id = $1 AND object_type_id = $2 AND primary_key = $3
           AND deleted = false`,
        [ontologyId, objectTypeId, primaryKey],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToRecord(row) : undefined;
    },

    async getById(id) {
      const result = await sql.query(
        `SELECT * FROM platform_objects WHERE id = $1 AND deleted = false`,
        [id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToRecord(row) : undefined;
    },

    async list(ontologyId: OntologyId, objectTypeId: ObjectTypeId, opts?: ListObjectsOptions) {
      const includeDeleted = opts?.includeDeleted ?? false;
      const result = await sql.query(
        `SELECT * FROM platform_objects
         WHERE ontology_id = $1 AND object_type_id = $2
           AND ($3::boolean OR deleted = false)
         ORDER BY primary_key
         LIMIT $4 OFFSET $5`,
        [
          ontologyId,
          objectTypeId,
          includeDeleted,
          opts?.limit ?? 10_000,
          opts?.offset ?? 0,
        ],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToRecord);
    },

    async update(
      ontologyId: OntologyId,
      objectTypeId: ObjectTypeId,
      primaryKey: string,
      input: UpdateObjectInput,
    ) {
      const current = await this.get(ontologyId, objectTypeId, primaryKey);
      if (!current) throw new Error(`object not found: ${objectTypeId}/${primaryKey}`);
      if (input.expectedVersion != null && current.version !== input.expectedVersion) {
        throw new Error(
          `version conflict: expected ${input.expectedVersion}, got ${current.version}`,
        );
      }
      const properties =
        input.mode === 'replace'
          ? input.properties
          : { ...current.properties, ...input.properties };
      const now = clock();
      const result = await sql.query(
        `UPDATE platform_objects
         SET properties = $1::jsonb, version = version + 1, updated_at = $2
         WHERE ontology_id = $3 AND object_type_id = $4 AND primary_key = $5 AND deleted = false
         RETURNING *`,
        [JSON.stringify(properties), now, ontologyId, objectTypeId, primaryKey],
      );
      return rowToRecord(result.rows[0] as Record<string, unknown>);
    },

    async delete(ontologyId, objectTypeId, primaryKey) {
      const now = clock();
      const result = await sql.query(
        `UPDATE platform_objects
         SET deleted = true, version = version + 1, updated_at = $1
         WHERE ontology_id = $2 AND object_type_id = $3 AND primary_key = $4 AND deleted = false
         RETURNING id`,
        [now, ontologyId, objectTypeId, primaryKey],
      );
      return result.rows.length > 0;
    },
  };
}
