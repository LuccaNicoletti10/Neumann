/**
 * object-platform — src/core/pg-object-repository.ts
 * PostgreSQL ObjectRepository with atomic optimistic concurrency (CAS).
 *
 * Soft-delete recreate: UPSERT revives same logical row (identity stable).
 */

import type {
  CreateObjectInput,
  DeleteObjectInput,
  ListObjectsOptions,
  ObjectRecord,
  ObjectRepository,
  OntologyId,
  ObjectTypeId,
  SqlClient,
  UpdateObjectInput,
} from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import { ObjectNotFoundError, VersionConflictError } from './errors.js';
import type { Clock, IdGenerator } from './types.js';

export type { SqlClient };

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
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();

  return {
    async create(input: CreateObjectInput): Promise<ObjectRecord> {
      const id = input.id ?? nextId('obj');
      const now = clock();
      // Revive soft-deleted logical identity; reject if live duplicate.
      const result = await sql.query(
        `INSERT INTO platform_objects (
           id, ontology_id, ontology_version_id, object_type_id, primary_key,
           properties, version, deleted, source, provenance, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,1,false,$7,$8::jsonb,$9,$9)
         ON CONFLICT (ontology_id, object_type_id, primary_key) DO UPDATE
           SET
             properties = EXCLUDED.properties,
             ontology_version_id = COALESCE(EXCLUDED.ontology_version_id, platform_objects.ontology_version_id),
             source = COALESCE(EXCLUDED.source, platform_objects.source),
             provenance = COALESCE(EXCLUDED.provenance, platform_objects.provenance),
             deleted = false,
             version = platform_objects.version + 1,
             updated_at = EXCLUDED.updated_at
           WHERE platform_objects.deleted = true
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
      if (!result.rows[0]) {
        throw new Error(
          `object already exists: ${input.objectTypeId}/${input.primaryKey}`,
        );
      }
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
      const params: unknown[] = [ontologyId, objectTypeId, includeDeleted];
      let orderSql = 'ORDER BY primary_key ASC';
      if (opts?.orderBy) {
        const prop = opts.orderBy.property;
        if (!/^[A-Za-z0-9_.:-]+$/.test(prop)) {
          throw new Error(`invalid orderBy property: ${prop}`);
        }
        const dir = opts.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
        params.push(prop);
        orderSql = `ORDER BY properties->>$${params.length} ${dir} NULLS LAST, primary_key ASC`;
      }
      params.push(opts?.limit ?? 10_000);
      const limitParam = params.length;
      params.push(opts?.offset ?? 0);
      const offsetParam = params.length;
      const result = await sql.query(
        `SELECT * FROM platform_objects
         WHERE ontology_id = $1 AND object_type_id = $2
           AND ($3::boolean OR deleted = false)
         ${orderSql}
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params,
      );
      return (result.rows as Record<string, unknown>[]).map(rowToRecord);
    },

    async listAll(ontologyId: OntologyId, opts?: ListObjectsOptions) {
      const includeDeleted = opts?.includeDeleted ?? false;
      const result = await sql.query(
        `SELECT * FROM platform_objects
         WHERE ontology_id = $1
           AND ($2::boolean OR deleted = false)
         ORDER BY object_type_id ASC, primary_key ASC
         LIMIT $3 OFFSET $4`,
        [ontologyId, includeDeleted, opts?.limit ?? 10_000, opts?.offset ?? 0],
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
      if (!current) {
        throw new ObjectNotFoundError(`object not found: ${objectTypeId}/${primaryKey}`);
      }
      const expected = input.expectedVersion ?? current.version;
      if (input.expectedVersion != null && current.version !== input.expectedVersion) {
        throw new VersionConflictError(
          `version conflict: expected ${input.expectedVersion}, got ${current.version}`,
          {
            expectedVersion: input.expectedVersion,
            actualVersion: current.version,
            objectTypeId,
            primaryKey,
          },
        );
      }
      const properties =
        input.mode === 'replace'
          ? input.properties
          : { ...current.properties, ...input.properties };
      const now = clock();
      const provenance = input.provenance
        ? { ...current.provenance, ...input.provenance }
        : current.provenance;
      const result = await sql.query(
        `UPDATE platform_objects
         SET properties = $1::jsonb, version = version + 1, updated_at = $2,
             provenance = COALESCE($7::jsonb, provenance),
             ontology_version_id = COALESCE($8, ontology_version_id)
         WHERE ontology_id = $3 AND object_type_id = $4 AND primary_key = $5
           AND deleted = false AND version = $6
         RETURNING *`,
        [
          JSON.stringify(properties),
          now,
          ontologyId,
          objectTypeId,
          primaryKey,
          expected,
          provenance ? JSON.stringify(provenance) : null,
          input.migrateToOntologyVersionId ?? null,
        ],
      );
      if (!result.rows[0]) {
        throw new VersionConflictError(
          `version conflict: expected ${expected}`,
          { expectedVersion: expected, objectTypeId, primaryKey },
        );
      }
      return rowToRecord(result.rows[0] as Record<string, unknown>);
    },

    async delete(ontologyId, objectTypeId, primaryKey, input?: DeleteObjectInput) {
      const expected = input?.expectedVersion;
      if (expected != null) {
        const current = await this.get(ontologyId, objectTypeId, primaryKey);
        if (!current) {
          throw new ObjectNotFoundError(`object not found: ${objectTypeId}/${primaryKey}`);
        }
        if (current.version !== expected) {
          throw new VersionConflictError(
            `version conflict: expected ${expected}, got ${current.version}`,
            {
              expectedVersion: expected,
              actualVersion: current.version,
              objectTypeId,
              primaryKey,
            },
          );
        }
      }
      const now = clock();
      const result = await sql.query(
        `UPDATE platform_objects
         SET deleted = true, version = version + 1, updated_at = $1
         WHERE ontology_id = $2 AND object_type_id = $3 AND primary_key = $4
           AND deleted = false
           AND ($5::int IS NULL OR version = $5)
         RETURNING *`,
        [now, ontologyId, objectTypeId, primaryKey, expected ?? null],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        if (expected != null) {
          throw new VersionConflictError(`version conflict: expected ${expected}`, {
            expectedVersion: expected,
            objectTypeId,
            primaryKey,
          });
        }
        return undefined;
      }
      return rowToRecord(row);
    },
  };
}
