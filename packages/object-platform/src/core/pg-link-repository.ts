/**
 * object-platform — src/core/pg-link-repository.ts
 * PostgreSQL LinkRepository: advisory locks + SELECT FOR UPDATE endpoints +
 * cardinality + versioned soft-delete links.
 *
 * WORLD NOW = deleted=false AND both endpoints live.
 * Object soft-delete does not cascade-delete links (WORLD HISTORY).
 */

import type {
  CreateLinkInput,
  LinkRecord,
  LinkRepository,
  LinkTypeId,
  ListLinksOptions,
  ObjectTypeId,
  OntologyId,
  SqlClient,
  TransactionManager,
} from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import { LinkIntegrityError } from './errors.js';
import {
  cardinalityLockKeys,
  cardinalityViolation,
  resolveCardinality,
} from './link-integrity.js';
import type { Clock, IdGenerator } from './types.js';

export interface CreatePgLinkRepositoryOptions {
  sql: SqlClient;
  clock?: Clock;
  nextId?: IdGenerator;
  objectExists?: (
    ontologyId: string,
    objectTypeId: string,
    primaryKey: string,
  ) => boolean | Promise<boolean>;
  cardinalityOf?: (
    ontologyId: string,
    linkTypeId: string,
  ) => string | undefined | Promise<string | undefined>;
}

function rowToLink(row: Record<string, unknown>): LinkRecord {
  return {
    id: String(row.id),
    ontologyId: String(row.ontology_id),
    linkTypeId: String(row.link_type_id),
    sourceObjectTypeId: String(row.source_object_type_id),
    sourcePrimaryKey: String(row.source_primary_key),
    targetObjectTypeId: String(row.target_object_type_id),
    targetPrimaryKey: String(row.target_primary_key),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: row.updated_at
      ? new Date(String(row.updated_at)).toISOString()
      : undefined,
    version: row.version != null ? Number(row.version) : undefined,
    deleted: row.deleted != null ? Boolean(row.deleted) : undefined,
    cardinality: row.cardinality
      ? (String(row.cardinality) as LinkRecord['cardinality'])
      : undefined,
    source: row.source != null ? String(row.source) : undefined,
    provenance: (row.provenance as Record<string, unknown>) ?? undefined,
    principal: row.principal != null ? String(row.principal) : undefined,
  };
}

function hasTransaction(sql: SqlClient): sql is SqlClient & TransactionManager {
  return typeof (sql as unknown as TransactionManager).transaction === 'function';
}

async function inTx<T>(sql: SqlClient, fn: (client: SqlClient) => Promise<T>): Promise<T> {
  if (hasTransaction(sql)) return sql.transaction(fn);
  return fn(sql);
}

function liveGraphPredicate(includeDeletedLinks?: boolean, includeDeletedEndpoints?: boolean): string {
  const liveLink = includeDeletedLinks ? 'TRUE' : 'l.deleted = false';
  const liveEnds = includeDeletedEndpoints
    ? 'TRUE'
    : `(
         EXISTS (
           SELECT 1 FROM platform_objects s
           WHERE s.ontology_id = l.ontology_id
             AND s.object_type_id = l.source_object_type_id
             AND s.primary_key = l.source_primary_key
             AND s.deleted = false
         )
         AND EXISTS (
           SELECT 1 FROM platform_objects t
           WHERE t.ontology_id = l.ontology_id
             AND t.object_type_id = l.target_object_type_id
             AND t.primary_key = l.target_primary_key
             AND t.deleted = false
         )
       )`;
  return `${liveLink} AND ${liveEnds}`;
}

export function createPgLinkRepository(
  opts: CreatePgLinkRepositoryOptions,
): LinkRepository {
  const { sql } = opts;
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();

  return {
    async create(input: CreateLinkInput): Promise<LinkRecord> {
      return inTx(sql, async (client) => {
        const locks = cardinalityLockKeys(input);
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1 || current_schema()), hashtext($2 || current_schema()))`,
          [locks.fromKey, locks.scopeKey],
        );
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1 || current_schema()), hashtext($2 || current_schema()))`,
          [locks.toKey, locks.scopeKey],
        );

        const endpoints = [
          {
            objectTypeId: input.sourceObjectTypeId,
            primaryKey: input.sourcePrimaryKey,
          },
          {
            objectTypeId: input.targetObjectTypeId,
            primaryKey: input.targetPrimaryKey,
          },
        ].sort(
          (a, b) =>
            a.objectTypeId.localeCompare(b.objectTypeId) ||
            a.primaryKey.localeCompare(b.primaryKey),
        );
        const seen = new Set<string>();
        for (const ep of endpoints) {
          const k = `${ep.objectTypeId}\0${ep.primaryKey}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const locked = await client.query(
            `SELECT id FROM platform_objects
             WHERE ontology_id = $1 AND object_type_id = $2 AND primary_key = $3
               AND deleted = false
             FOR UPDATE`,
            [input.ontologyId, ep.objectTypeId, ep.primaryKey],
          );
          if (!locked.rows[0]) {
            throw new LinkIntegrityError('link endpoints must reference existing objects');
          }
        }

        if (opts.objectExists) {
          const srcOk = await opts.objectExists(
            input.ontologyId,
            input.sourceObjectTypeId,
            input.sourcePrimaryKey,
          );
          const tgtOk = await opts.objectExists(
            input.ontologyId,
            input.targetObjectTypeId,
            input.targetPrimaryKey,
          );
          if (!srcOk || !tgtOk) {
            throw new LinkIntegrityError('link endpoints must reference existing objects');
          }
        }

        const schemaCardinality = opts.cardinalityOf
          ? await opts.cardinalityOf(input.ontologyId, input.linkTypeId)
          : undefined;
        const cardinality = resolveCardinality(schemaCardinality, input.cardinality);

        const fromSource = await client.query(
          `SELECT 1 AS ok FROM platform_links
           WHERE ontology_id = $1 AND link_type_id = $2
             AND source_object_type_id = $3 AND source_primary_key = $4
             AND deleted = false
           LIMIT 1`,
          [input.ontologyId, input.linkTypeId, input.sourceObjectTypeId, input.sourcePrimaryKey],
        );
        const intoTarget = await client.query(
          `SELECT 1 AS ok FROM platform_links
           WHERE ontology_id = $1 AND link_type_id = $2
             AND target_object_type_id = $3 AND target_primary_key = $4
             AND deleted = false
           LIMIT 1`,
          [input.ontologyId, input.linkTypeId, input.targetObjectTypeId, input.targetPrimaryKey],
        );
        const violated = cardinalityViolation(
          cardinality,
          (fromSource.rows?.length ?? 0) > 0,
          (intoTarget.rows?.length ?? 0) > 0,
        );
        if (violated) throw new LinkIntegrityError(`${violated} (${input.linkTypeId})`);

        const id = nextId('link');
        const now = clock();
        try {
          const result = await client.query(
            `INSERT INTO platform_links (
               id, ontology_id, link_type_id,
               source_object_type_id, source_primary_key,
               target_object_type_id, target_primary_key,
               cardinality, created_at, updated_at, version, deleted,
               source, provenance, principal
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,1,false,$10,$11::jsonb,$12)
             ON CONFLICT (
               ontology_id, link_type_id,
               source_object_type_id, source_primary_key,
               target_object_type_id, target_primary_key
             ) DO UPDATE
               SET
                 deleted = false,
                 version = platform_links.version + 1,
                 updated_at = EXCLUDED.updated_at,
                 cardinality = COALESCE(EXCLUDED.cardinality, platform_links.cardinality),
                 source = COALESCE(EXCLUDED.source, platform_links.source),
                 provenance = COALESCE(EXCLUDED.provenance, platform_links.provenance),
                 principal = COALESCE(EXCLUDED.principal, platform_links.principal)
               WHERE platform_links.deleted = true
             RETURNING *`,
            [
              id,
              input.ontologyId,
              input.linkTypeId,
              input.sourceObjectTypeId,
              input.sourcePrimaryKey,
              input.targetObjectTypeId,
              input.targetPrimaryKey,
              cardinality ?? null,
              now,
              input.source ?? null,
              input.provenance ? JSON.stringify(input.provenance) : null,
              input.principal ?? null,
            ],
          );
          if (!result.rows[0]) {
            throw new LinkIntegrityError(`link already exists: ${input.linkTypeId}`);
          }
          return rowToLink(result.rows[0] as Record<string, unknown>);
        } catch (err) {
          if (err instanceof LinkIntegrityError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          if (/unique|duplicate/i.test(msg)) {
            throw new LinkIntegrityError(`link already exists: ${input.linkTypeId}`);
          }
          throw err;
        }
      });
    },

    async delete(
      ontologyId,
      linkTypeId,
      sourceObjectTypeId,
      sourcePrimaryKey,
      targetObjectTypeId,
      targetPrimaryKey,
    ) {
      return inTx(sql, async (client) => {
        const now = clock();
        const result = await client.query(
          `UPDATE platform_links
           SET deleted = true, version = version + 1, updated_at = $1
           WHERE ontology_id = $2 AND link_type_id = $3
             AND source_object_type_id = $4 AND source_primary_key = $5
             AND target_object_type_id = $6 AND target_primary_key = $7
             AND deleted = false
           RETURNING id`,
          [
            now,
            ontologyId,
            linkTypeId,
            sourceObjectTypeId,
            sourcePrimaryKey,
            targetObjectTypeId,
            targetPrimaryKey,
          ],
        );
        return result.rows.length > 0;
      });
    },

    async listFrom(
      ontologyId: OntologyId,
      sourceObjectTypeId: ObjectTypeId,
      sourcePrimaryKey: string,
      linkTypeId?: LinkTypeId,
      listOpts?: ListLinksOptions,
    ) {
      const predicate = liveGraphPredicate(
        listOpts?.includeDeletedLinks,
        listOpts?.includeDeletedEndpoints,
      );
      const result = await sql.query(
        `SELECT l.* FROM platform_links l
         WHERE l.ontology_id = $1
           AND l.source_object_type_id = $2
           AND l.source_primary_key = $3
           AND ($4::text IS NULL OR l.link_type_id = $4)
           AND ${predicate}`,
        [ontologyId, sourceObjectTypeId, sourcePrimaryKey, linkTypeId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToLink);
    },

    async listTo(
      ontologyId: OntologyId,
      targetObjectTypeId: ObjectTypeId,
      targetPrimaryKey: string,
      linkTypeId?: LinkTypeId,
      listOpts?: ListLinksOptions,
    ) {
      const predicate = liveGraphPredicate(
        listOpts?.includeDeletedLinks,
        listOpts?.includeDeletedEndpoints,
      );
      const result = await sql.query(
        `SELECT l.* FROM platform_links l
         WHERE l.ontology_id = $1
           AND l.target_object_type_id = $2
           AND l.target_primary_key = $3
           AND ($4::text IS NULL OR l.link_type_id = $4)
           AND ${predicate}`,
        [ontologyId, targetObjectTypeId, targetPrimaryKey, linkTypeId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToLink);
    },
  };
}
