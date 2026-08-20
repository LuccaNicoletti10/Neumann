/**
 * ingestion-runtime — mapping_versions append-only in PostgreSQL (0024) + nonce TTL.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createIdGenerator,
  createUuidIdGenerator,
  tryOpenIsolatedPg,
} from 'object-platform';

import {
  createPgIngestionStore,
  createPgMappingVersionRepository,
} from '../src/index.js';

const db = await tryOpenIsolatedPg();

const mappingInput = {
  mappingId: 'map-imm',
  ontologyId: 'ont-1',
  ontologyVersionId: 'ov-1',
  datasetId: 'ds',
  objectTypeId: 'ot.item',
  primaryKeyFields: ['id'] as string[],
  propertyMappings: [{ sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' as const }],
  createdBy: 'test',
};

describe.skipIf(!db)('mapping_versions SQL immutability and nonce TTL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('INSERT works; UPDATE/DELETE of published versions fail; identical hash is no-op', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const mappings = createPgMappingVersionRepository({ sql: db.sql, clock, nextId });
    const v1 = await mappings.publish(mappingInput);
    expect(v1.versionNumber).toBe(1);

    await expect(
      db.sql.query(`UPDATE mapping_versions SET definition = '{}'::jsonb WHERE id = $1`, [v1.id]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.sql.query(`UPDATE mapping_versions SET content_hash = 'tampered' WHERE id = $1`, [v1.id]),
    ).rejects.toThrow(/append-only/i);
    await expect(db.sql.query(`DELETE FROM mapping_versions WHERE id = $1`, [v1.id])).rejects.toThrow(
      /append-only/i,
    );

    const identical = await mappings.publish(mappingInput);
    expect(identical.id).toBe(v1.id);
    const count = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM mapping_versions WHERE mapping_id = $1`,
      [mappingInput.mappingId],
    );
    expect(Number(count.rows[0]?.n)).toBe(1);

    const beforeFail = Number(count.rows[0]?.n);
    await expect(
      db.sql.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO mapping_versions (
             id, mapping_id, version_number, content_hash, ontology_id, ontology_version_id,
             dataset_id, object_type_id, definition, created_by, published_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb,$9,$10)`,
          [
            'mapv-fail',
            mappingInput.mappingId,
            2,
            'hash-fail',
            mappingInput.ontologyId,
            mappingInput.ontologyVersionId,
            mappingInput.datasetId,
            mappingInput.objectTypeId,
            'test',
            clock(),
          ],
        );
        await tx.query(`UPDATE mapping_versions SET content_hash = 'x' WHERE id = $1`, [v1.id]);
      }),
    ).rejects.toThrow(/append-only/i);
    const afterFail = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM mapping_versions WHERE mapping_id = $1`,
      [mappingInput.mappingId],
    );
    expect(Number(afterFail.rows[0]?.n)).toBe(beforeFail);
    const still = await mappings.getVersion(v1.id);
    expect(still?.contentHash).toBe(v1.contentHash);
  });

  it('concurrent publish of the same (mappingId, version) has one winner', async () => {
    if (!db) return;
    const a = db.reconnect();
    const b = db.reconnect();
    const clock = createDeterministicClock();
    const input = {
      ...mappingInput,
      mappingId: 'map-cas',
      propertyMappings: [
        { sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' as const },
        { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' as const },
      ],
    };
    try {
      const results = await Promise.allSettled([
        createPgMappingVersionRepository({ sql: a, clock, nextId: createUuidIdGenerator() }).publish(input),
        createPgMappingVersionRepository({ sql: b, clock, nextId: createUuidIdGenerator() }).publish(input),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const rows = await db.sql.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM mapping_versions WHERE mapping_id = $1`,
        [input.mappingId],
      );
      expect(Number(rows.rows[0]?.n)).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('expires_at is indexed; purge removes only expired nonces; valid nonces stay', async () => {
    if (!db) return;
    const idx = await db.sql.query<{ relname: string }>(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'ingestion_webhook_nonces_expires_at_idx'
         AND n.nspname = current_schema()`,
    );
    expect(idx.rows).toHaveLength(1);

    const store = createPgIngestionStore({ sql: db.sql, transaction: db.sql });
    const now = '2024-01-01T00:00:00.000Z';
    await store.acceptWebhook({
      connectorId: 'wh',
      sourceEventId: 'e-live',
      payloadHash: 'h-live',
      envelope: {
        connectorId: 'wh',
        source: 'wh',
        sourceEventId: 'e-live',
        occurredAt: now,
        payload: { id: 'e-live' },
        metadata: {},
      },
      envelopeId: 'env-live',
      run: {
        id: 'ing-live',
        kind: 'webhook',
        status: 'pending',
        connectorId: 'wh',
        principal: 'svc',
        pin: {
          mappingVersionId: 'mv',
          mappingId: 'map',
          version: 1,
          ontologyId: 'ont',
          ontologyVersionId: 'ov',
          hash: 'h',
          definition: {
            objectTypeId: 'ot.item',
            primaryKeyFields: ['id'],
            propertyMappings: [],
            linkMappings: [],
          },
        },
        objectName: 'events',
        processedCount: 0,
        quarantinedCount: 0,
        createdAt: now,
        updatedAt: now,
      },
      now,
      nonce: 'n-live',
      nonceExpiresAt: '2024-01-01T00:10:00.000Z',
    });
    await db.sql.query(
      `INSERT INTO ingestion_webhook_nonces (
         connector_id, nonce, source_event_id, payload_hash, run_id, created_at, expires_at
       ) VALUES ('wh','n-dead','e-dead','h-dead','ing-live',$1,$2)`,
      ['2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'],
    );
    const removed = await store.purgeExpiredNonces('2024-01-01T00:00:01.000Z');
    expect(removed).toBe(1);
    const live = await db.sql.query(
      `SELECT nonce FROM ingestion_webhook_nonces WHERE nonce = 'n-live'`,
    );
    expect(live.rows).toHaveLength(1);
    const dead = await db.sql.query(
      `SELECT nonce FROM ingestion_webhook_nonces WHERE nonce = 'n-dead'`,
    );
    expect(dead.rows).toHaveLength(0);
  });
});
