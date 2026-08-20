/**
 * ingestion-runtime — PostgreSQL MappingVersionRepository (0023).
 */

import type { MappingVersion, MappingVersionRepository, SqlClient } from 'contracts';
import { hashCanonical } from 'object-platform';

import { IngestionVersionConflictError } from './errors.js';

function rowToVersion(row: Record<string, unknown>): MappingVersion {
  const def = row.definition as {
    primaryKeyFields: MappingVersion['primaryKeyFields'];
    propertyMappings: MappingVersion['propertyMappings'];
    linkMappings: MappingVersion['linkMappings'];
  };
  return {
    id: String(row.id),
    mappingId: String(row.mapping_id),
    versionNumber: Number(row.version_number),
    parentVersionId: row.parent_version_id == null ? undefined : String(row.parent_version_id),
    createdAt: new Date(String(row.published_at)).toISOString(),
    createdBy: String(row.created_by),
    contentHash: String(row.content_hash),
    status: 'COMMITTED',
    datasetId: String(row.dataset_id),
    ontologyVersionId: String(row.ontology_version_id),
    objectTypeId: String(row.object_type_id),
    primaryKeyFields: [...def.primaryKeyFields],
    propertyMappings: def.propertyMappings.map((p) => ({ ...p })),
    linkMappings: def.linkMappings.map((l) => ({ ...l })),
  };
}

export function createPgMappingVersionRepository(opts: {
  sql: SqlClient;
  clock: () => string;
  nextId: (prefix: string) => string;
}): MappingVersionRepository {
  const { sql } = opts;
  return {
    async getVersion(id) {
      const found = await sql.query(`SELECT * FROM mapping_versions WHERE id = $1`, [id]);
      const row = found.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToVersion(row) : undefined;
    },
    async getLatest(mappingId) {
      const found = await sql.query(
        `SELECT * FROM mapping_versions WHERE mapping_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [mappingId],
      );
      const row = found.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToVersion(row) : undefined;
    },
    async publish(input) {
      const content = {
        datasetId: input.datasetId,
        ontologyVersionId: input.ontologyVersionId,
        objectTypeId: input.objectTypeId,
        primaryKeyFields: input.primaryKeyFields,
        propertyMappings: input.propertyMappings,
        linkMappings: input.linkMappings ?? [],
      };
      const hash = hashCanonical(content);
      const existing = await sql.query(
        `SELECT * FROM mapping_versions WHERE mapping_id = $1 AND content_hash = $2`,
        [input.mappingId, hash],
      );
      const hit = existing.rows[0] as Record<string, unknown> | undefined;
      if (hit) return rowToVersion(hit);

      const latest = await sql.query(
        `SELECT id, version_number FROM mapping_versions
         WHERE mapping_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [input.mappingId],
      );
      const last = latest.rows[0] as { id: string; version_number: number } | undefined;
      const versionNumber = (last?.version_number ?? 0) + 1;
      const id = opts.nextId('mapv');
      const publishedAt = opts.clock();
      const definition = {
        primaryKeyFields: input.primaryKeyFields,
        propertyMappings: input.propertyMappings,
        linkMappings: input.linkMappings ?? [],
      };
      try {
        await sql.query(
          `INSERT INTO mapping_versions (
             id, mapping_id, version_number, content_hash, ontology_id, ontology_version_id,
             source_schema_version, dataset_id, object_type_id, definition, created_by,
             parent_version_id, published_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
          [
            id,
            input.mappingId,
            versionNumber,
            hash,
            input.ontologyId,
            input.ontologyVersionId,
            input.sourceSchemaVersion ?? null,
            input.datasetId,
            input.objectTypeId,
            JSON.stringify(definition),
            input.createdBy,
            last?.id ?? null,
            publishedAt,
          ],
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate/i.test(message)) {
          const raced = await sql.query(
            `SELECT * FROM mapping_versions WHERE mapping_id = $1 AND content_hash = $2`,
            [input.mappingId, hash],
          );
          const again = raced.rows[0] as Record<string, unknown> | undefined;
          if (again) return rowToVersion(again);
          throw new IngestionVersionConflictError(
            `mapping version CAS conflict for ${input.mappingId}`,
          );
        }
        throw err;
      }
      const stored = await sql.query(`SELECT * FROM mapping_versions WHERE id = $1`, [id]);
      return rowToVersion(stored.rows[0] as Record<string, unknown>);
    },
  };
}
