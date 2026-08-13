/**
 * object-platform — src/core/pg-link-repository.ts
 * PostgreSQL LinkRepository.
 */

import type {
  CreateLinkInput,
  LinkRecord,
  LinkRepository,
  LinkTypeId,
  ObjectTypeId,
  OntologyId,
} from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import type { Clock, IdGenerator } from './types.js';
import type { SqlClient } from './pg-object-repository.js';

export interface CreatePgLinkRepositoryOptions {
  sql: SqlClient;
  clock?: Clock;
  nextId?: IdGenerator;
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
    cardinality: row.cardinality
      ? (String(row.cardinality) as LinkRecord['cardinality'])
      : undefined,
  };
}

export function createPgLinkRepository(
  opts: CreatePgLinkRepositoryOptions,
): LinkRepository {
  const { sql } = opts;
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();

  return {
    async create(input: CreateLinkInput): Promise<LinkRecord> {
      const id = nextId('link');
      const now = clock();
      const result = await sql.query(
        `INSERT INTO platform_links (
           id, ontology_id, link_type_id,
           source_object_type_id, source_primary_key,
           target_object_type_id, target_primary_key,
           cardinality, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id,
          input.ontologyId,
          input.linkTypeId,
          input.sourceObjectTypeId,
          input.sourcePrimaryKey,
          input.targetObjectTypeId,
          input.targetPrimaryKey,
          input.cardinality ?? null,
          now,
        ],
      );
      return rowToLink(result.rows[0] as Record<string, unknown>);
    },

    async delete(
      ontologyId,
      linkTypeId,
      sourceObjectTypeId,
      sourcePrimaryKey,
      targetObjectTypeId,
      targetPrimaryKey,
    ) {
      const result = await sql.query(
        `DELETE FROM platform_links
         WHERE ontology_id = $1 AND link_type_id = $2
           AND source_object_type_id = $3 AND source_primary_key = $4
           AND target_object_type_id = $5 AND target_primary_key = $6
         RETURNING id`,
        [
          ontologyId,
          linkTypeId,
          sourceObjectTypeId,
          sourcePrimaryKey,
          targetObjectTypeId,
          targetPrimaryKey,
        ],
      );
      return result.rows.length > 0;
    },

    async listFrom(
      ontologyId: OntologyId,
      sourceObjectTypeId: ObjectTypeId,
      sourcePrimaryKey: string,
      linkTypeId?: LinkTypeId,
    ) {
      const result = await sql.query(
        `SELECT * FROM platform_links
         WHERE ontology_id = $1
           AND source_object_type_id = $2
           AND source_primary_key = $3
           AND ($4::text IS NULL OR link_type_id = $4)`,
        [ontologyId, sourceObjectTypeId, sourcePrimaryKey, linkTypeId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToLink);
    },

    async listTo(
      ontologyId: OntologyId,
      targetObjectTypeId: ObjectTypeId,
      targetPrimaryKey: string,
      linkTypeId?: LinkTypeId,
    ) {
      const result = await sql.query(
        `SELECT * FROM platform_links
         WHERE ontology_id = $1
           AND target_object_type_id = $2
           AND target_primary_key = $3
           AND ($4::text IS NULL OR link_type_id = $4)`,
        [ontologyId, targetObjectTypeId, targetPrimaryKey, linkTypeId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToLink);
    },
  };
}
