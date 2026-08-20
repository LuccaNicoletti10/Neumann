/**
 * platform-api — PostgreSQL crash window between ProjectionWriter commit and checkpoint.
 * Two independent pools. Does not reuse runtime or pool to simulate restart.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { IngestionCrashFailpointError } from 'ingestion-runtime';
import { tryOpenIsolatedPg } from 'object-platform';
import type { PolicyOverlay } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';

const db = await tryOpenIsolatedPg();

const overlay: PolicyOverlay = {
  roles: { svc: ['ingest'] },
  grants: [
    {
      role: 'ingest',
      ontologyIds: ['*'],
      objectTypes: ['ot.item'],
      adminResources: ['ingest', 'projection'],
      operations: ['read', 'modify'],
    },
  ],
};

async function seed(ctx: Awaited<ReturnType<typeof createPostgresPlatformContext>>, path: string) {
  const o = await ctx.ontology.createOntology({ name: 'crash' });
  await ctx.ontology.addPropertyType(o.id, {
    id: 'pt.code',
    displayName: 'Code',
    baseType: 'string',
  });
  await ctx.ontology.addPropertyType(o.id, {
    id: 'pt.name',
    displayName: 'Name',
    baseType: 'string',
  });
  await ctx.ontology.addObjectType(o.id, {
    id: 'ot.item',
    displayName: 'Item',
    propertyTypeIds: ['pt.code', 'pt.name'],
  });
  const v1 = await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  const mapping = await ctx.mappingVersions.publish({
    mappingId: 'map-crash',
    ontologyId: o.id,
    ontologyVersionId: v1.id,
    datasetId: 'ds',
    objectTypeId: 'ot.item',
    primaryKeyFields: ['id'],
    propertyMappings: [
      { sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' },
      { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' },
    ],
    createdBy: 'test',
  });
  await ctx.connectorRegistrations.put({
    connectorId: 'csv-crash',
    kind: 'csv',
    enabled: true,
    config: { path },
    servicePrincipal: 'svc',
    mappingId: mapping.mappingId,
    ontologyId: o.id,
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { ontologyId: o.id, mappingId: mapping.mappingId };
}

async function count(sql: { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, ontologyId: string) {
  const objects = await sql.query(
    `SELECT count(*)::text AS n FROM platform_objects
     WHERE ontology_id = $1 AND object_type_id = 'ot.item' AND deleted = false`,
    [ontologyId],
  );
  const links = await sql.query(
    `SELECT count(*)::text AS n FROM platform_links WHERE ontology_id = $1`,
    [ontologyId],
  );
  const history = await sql.query(
    `SELECT count(*)::text AS n FROM platform_object_history
     WHERE ontology_id = $1 AND object_type_id = 'ot.item'`,
    [ontologyId],
  );
  const events = await sql.query(
    `SELECT count(*)::text AS n FROM platform_operational_events
     WHERE ontology_id = $1 AND object_type_id = 'ot.item'`,
    [ontologyId],
  );
  const audit = await sql.query(
    `SELECT count(*)::text AS n FROM platform_audit_entries
     WHERE ontology_id = $1 AND event_data LIKE '%ProjectionApplied%'`,
    [ontologyId],
  );
  const outbox = await sql.query(
    `SELECT count(*)::text AS n FROM outbox_events
     WHERE payload->>'sourceEventId' IS NOT NULL
       AND topic = 'projection.applied'`,
  );
  const ledger = await sql.query(
    `SELECT count(*)::text AS n FROM projection_ledger WHERE ontology_id = $1`,
    [ontologyId],
  );
  const checkpoint = await sql.query(
    `SELECT token FROM ingestion_checkpoints WHERE connector_id = 'csv-crash'`,
  );
  return {
    objects: Number(objects.rows[0]?.n ?? 0),
    links: Number(links.rows[0]?.n ?? 0),
    history: Number(history.rows[0]?.n ?? 0),
    events: Number(events.rows[0]?.n ?? 0),
    audit: Number(audit.rows[0]?.n ?? 0),
    outbox: Number(outbox.rows[0]?.n ?? 0),
    ledger: Number(ledger.rows[0]?.n ?? 0),
    checkpoint: checkpoint.rows[0]?.token ? String(checkpoint.rows[0].token) : null,
  };
}

describe.skipIf(!db)('Prompt 10C PostgreSQL crash window', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('kills the worker after domain commit and before checkpoint; restart is exactly-once', async () => {
    if (!db) return;
    const dir = mkdtempSync(join(tmpdir(), 'neumann-10c-crash-'));
    const path = join(dir, 'items.csv');
    writeFileSync(path, 'id,name\ncrash-1,alpha\n');

    const sqlA = db.reconnect();
    const ctxA = await createPostgresPlatformContext({
      sql: sqlA,
      transaction: sqlA,
      overlay,
      ingestionPageSize: 1,
      afterProjectionBeforeCheckpoint: async () => {
        throw new IngestionCrashFailpointError();
      },
    });
    const { ontologyId, mappingId } = await seed(ctxA, path);
    await ctxA.ingestion.startPull({
      connectorId: 'csv-crash',
      mappingId,
      ontologyId,
      principal: 'svc',
    });
    await expect(ctxA.ingestionWorker.drainOnce()).rejects.toBeInstanceOf(IngestionCrashFailpointError);
    const afterCrash = await count(sqlA, ontologyId);
    expect(afterCrash.objects).toBe(1);
    expect(afterCrash.ledger).toBe(1);
    expect(afterCrash.checkpoint).toBeNull();
    await ctxA.close?.();
    await sqlA.close();

    const sqlB = db.reconnect();
    expect(sqlB).not.toBe(sqlA);
    const ctxB = await createPostgresPlatformContext({
      sql: sqlB,
      transaction: sqlB,
      overlay,
      ingestionPageSize: 1,
    });
    const connector = await ctxB.connectorRegistrations.get('csv-crash');
    expect(connector?.mappingId).toBe(mappingId);
    const ran = await ctxB.ingestionWorker.drainOnce();
    expect(ran).toBeGreaterThan(0);
    const runs = await sqlB.query<{ status: string; processed_count: string }>(
      `SELECT status, processed_count::text FROM ingestion_runs WHERE connector_id = 'csv-crash'`,
    );
    expect(runs.rows.some((row) => row.status === 'completed')).toBe(true);
    const final = await count(sqlB, ontologyId);
    expect(final).toEqual({
      objects: 1,
      links: 0,
      history: 1,
      events: 1,
      audit: 1,
      outbox: 1,
      ledger: 1,
      checkpoint: '1',
    });
    await ctxB.close?.();
    await sqlB.close();
  });
});
