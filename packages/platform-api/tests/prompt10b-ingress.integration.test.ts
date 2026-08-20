/**
 * platform-api — PostgreSQL HTTP ingest → worker → ProjectionWriter → API (ADR-0017).
 */
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createMemorySecretResolver, webhookSignedPayload } from 'ingestion-runtime';
import { tryOpenIsolatedPg } from 'object-platform';
import type { PolicyOverlay } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

const db = await tryOpenIsolatedPg();
const SECRET = 'whsec_pg';
const REF = 'connector:wh-pg:webhook-secret';

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

function sign(timestamp: string, nonce: string, raw: string): string {
  return createHmac('sha256', SECRET).update(webhookSignedPayload(timestamp, nonce, raw)).digest('hex');
}

async function seed(
  ctx: Awaited<ReturnType<typeof createPostgresPlatformContext>>,
  connectorId = 'wh-pg',
  enabled = true,
) {
  const o = await ctx.ontology.createOntology({ name: 'ing' });
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
    mappingId: `map-${connectorId}`,
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
    connectorId,
    kind: 'webhook',
    enabled,
    config: { endpoint: 'erp' },
    secretRef: REF,
    servicePrincipal: 'svc',
    mappingId: mapping.mappingId,
    ontologyId: o.id,
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { ontologyId: o.id, mappingId: mapping.mappingId, mappingVersionId: mapping.id };
}

describe.skipIf(!db)('Prompt 10B PostgreSQL ingress', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('HTTP signed webhook → 202 → worker → object readable by API', async () => {
    if (!db) return;
    const secrets = createMemorySecretResolver({ [REF]: SECRET });
    const ctx = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      overlay,
      secrets,
    });
    const { ontologyId } = await seed(ctx);
    const { app } = await createPlatformServer(ctx);
    const timestamp = new Date().toISOString();
    const raw = JSON.stringify({ id: 'pg1', name: 'from-http' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-pg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-pg1', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-pg1',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(202);
    const receipt = res.json() as { runId: string; sourceEventId: string; status: string };
    expect(receipt.status).toBe('accepted');
    expect(receipt.sourceEventId).toBe('pg1');
    const pin = await ctx.ingestion.getRun(receipt.runId);
    expect(pin?.pin.mappingVersionId).toBeTruthy();

    await ctx.ingestionWorker.drainOnce();
    const read = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/pg1`,
      headers: { 'x-principal': 'svc' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().properties['pt.name']).toBe('from-http');

    const history = await app.inject({
      method: 'GET',
      url: `/api/v2/objects/${read.json().id}/history`,
      headers: { 'x-principal': 'svc' },
    });
    expect(history.statusCode).toBeLessThan(500);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-pg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-pg1-b', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-pg1-b',
      },
      payload: raw,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().runId).toBe(receipt.runId);
    expect(replay.json().status).toBe('replayed');

    const nonceReuse = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-pg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-pg1', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-pg1',
      },
      payload: raw,
    });
    expect(nonceReuse.statusCode).toBe(409);
    expect(nonceReuse.json().errorName).toBe('INGESTION_NONCE_REPLAY');

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-pg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-pg-div', JSON.stringify({ id: 'pg1', name: 'other' })),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-pg-div',
      },
      payload: JSON.stringify({ id: 'pg1', name: 'other' }),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().errorName).toBe('INGESTION_EVENT_CONFLICT');
    const still = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/pg1`,
      headers: { 'x-principal': 'svc' },
    });
    expect(still.json().properties['pt.name']).toBe('from-http');

    const sql = ctx.sql!;
    const secretRows = await sql.query(
      `SELECT config::text AS cfg, secret_ref FROM connector_registrations WHERE connector_id = 'wh-pg'`,
    );
    expect(String(secretRows.rows[0]?.cfg)).not.toMatch(/whsec/);
    expect(String(secretRows.rows[0]?.cfg)).not.toMatch(/"secret"/);

    await ctx.close?.();
    await app.close();
  });

  it('invalid signature, disabled connector and oversized body persist zero inbox rows', async () => {
    if (!db) return;
    const schemaSql = db.reconnect();
    const secrets = createMemorySecretResolver({ [REF]: SECRET });
    const ctx = await createPostgresPlatformContext({
      sql: schemaSql,
      transaction: schemaSql,
      overlay,
      secrets,
    });
    await seed(ctx, 'wh-neg', true);
    await ctx.connectorRegistrations.put({
      connectorId: 'wh-off',
      kind: 'webhook',
      enabled: false,
      config: { endpoint: 'erp' },
      secretRef: REF,
      servicePrincipal: 'svc',
      mappingId: 'map-wh-neg',
      ontologyId: (await ctx.ontology.listOntologies())[0]!.id,
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const { app } = await createPlatformServer(ctx);
    const timestamp = new Date().toISOString();
    const raw = '{ "id": "x", "name": "nope" }';
    const compacted = JSON.stringify(JSON.parse(raw));
    expect(compacted).not.toBe(raw);
    const before = await schemaSql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingestion_webhook_inbox`,
    );

    const badSig = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-neg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': 'aa'.repeat(32),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'neg-1',
      },
      payload: raw,
    });
    expect(badSig.statusCode).toBe(401);

    const reserialized = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-neg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'neg-reser', compacted),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'neg-reser',
      },
      payload: raw,
    });
    expect(reserialized.statusCode).toBe(401);

    const expired = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-neg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign('2000-01-01T00:00:00.000Z', 'neg-exp', raw),
        'x-neumann-timestamp': '2000-01-01T00:00:00.000Z',
        'x-neumann-nonce': 'neg-exp',
      },
      payload: raw,
    });
    expect(expired.statusCode).toBe(401);

    const disabled = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-off',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'neg-2', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'neg-2',
      },
      payload: raw,
    });
    expect(disabled.statusCode).toBe(403);

    const oversized = `{"id":"x","name":"${'a'.repeat(1_048_576)}"}`;
    const tooBig = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-neg',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'neg-big', oversized),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'neg-big',
      },
      payload: oversized,
    });
    expect(tooBig.statusCode).toBe(413);

    const after = await schemaSql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingestion_webhook_inbox`,
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    await app.close();
    await ctx.close?.();
  });

  it('restart loads connectors and mappings; two workers share one lease', async () => {
    if (!db) return;
    const secrets = createMemorySecretResolver({ [REF]: SECRET });
    const first = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      overlay,
      secrets,
    });
    const { mappingId, ontologyId } = await seed(first, 'wh-restart');
    await first.close?.();

    const sqlB = db.reconnect();
    const second = await createPostgresPlatformContext({
      sql: sqlB,
      transaction: sqlB,
      overlay,
      secrets,
    });
    const connector = await second.connectorRegistrations.get('wh-restart');
    expect(connector?.mappingId).toBe(mappingId);
    const latest = await second.mappingVersions.getLatest(mappingId);
    expect(latest).toBeTruthy();

    const { app } = await createPlatformServer(second);
    const timestamp = new Date().toISOString();
    const raw = JSON.stringify({ id: 'oldpin', name: 'keep' });
    const posted = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-restart',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-restart', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-restart',
      },
      payload: raw,
    });
    expect(posted.statusCode).toBe(202);
    const runId = posted.json().runId as string;
    const run = await second.ingestion.getRun(runId);
    expect(run?.pin.mappingVersionId).toBe(latest!.id);

    const newer = await second.mappingVersions.publish({
      mappingId,
      ontologyId,
      ontologyVersionId: latest!.ontologyVersionId,
      datasetId: 'ds',
      objectTypeId: 'ot.item',
      primaryKeyFields: ['id'],
      propertyMappings: [
        { sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' },
        { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' },
        { sourceField: 'extra', propertyTypeId: 'pt.name', transform: 'string' },
      ],
      createdBy: 'test',
    });
    expect(newer.id).not.toBe(latest!.id);
    expect((await second.ingestion.getRun(runId))?.pin.mappingVersionId).toBe(latest!.id);

    const laterRaw = JSON.stringify({ id: 'newpin', name: 'later' });
    const later = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-restart',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-restart-2', laterRaw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-restart-2',
      },
      payload: laterRaw,
    });
    expect(later.statusCode).toBe(202);
    expect((await second.ingestion.getRun(later.json().runId as string))?.pin.mappingVersionId).toBe(
      newer.id,
    );

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-restart',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-restart', JSON.stringify({ id: 'other', name: 'x' })),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-restart',
      },
      payload: JSON.stringify({ id: 'other', name: 'x' }),
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().errorName).toBe('INGESTION_NONCE_REPLAY');

    const sqlC = db.reconnect();
    const third = await createPostgresPlatformContext({
      sql: sqlC,
      transaction: sqlC,
      overlay,
      secrets,
    });
    const [a, b] = await Promise.allSettled([
      second.ingestionWorker.drainOnce(),
      third.ingestionWorker.drainOnce(),
    ]);
    expect(a.status === 'fulfilled' || b.status === 'fulfilled').toBe(true);
    await second.ingestionWorker.drainOnce();
    const obj = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/oldpin`,
      headers: { 'x-principal': 'svc' },
    });
    expect(obj.statusCode).toBe(200);
    const laterObj = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/newpin`,
      headers: { 'x-principal': 'svc' },
    });
    expect(laterObj.statusCode).toBe(200);
    await app.close();
    await second.close?.();
    await third.close?.();
  });

  it('CSV registration survives restart and resumes the cursor', async () => {
    if (!db) return;
    const dir = mkdtempSync(join(tmpdir(), 'neumann-10b-csv-'));
    const path = join(dir, 'items.csv');
    writeFileSync(path, 'id,name\n1,first\n2,second\n');
    const secrets = createMemorySecretResolver({ [REF]: SECRET });
    const ctx = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      overlay,
      secrets,
      ingestionPageSize: 1,
    });
    const { ontologyId, mappingId } = await seed(ctx, 'csv-seed');
    await ctx.connectorRegistrations.put({
      connectorId: 'csv-resume',
      kind: 'csv',
      enabled: true,
      config: { path },
      servicePrincipal: 'svc',
      mappingId,
      ontologyId,
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const { app } = await createPlatformServer(ctx);
    await ctx.ingestion.startPull({
      connectorId: 'csv-resume',
      mappingId,
      ontologyId,
      principal: 'svc',
    });
    await ctx.ingestionWorker.drainOnce();
    const first = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/1`,
      headers: { 'x-principal': 'svc' },
    });
    expect(first.statusCode).toBe(200);
    await app.close();
    await ctx.close?.();

    const sqlB = db.reconnect();
    const reopened = await createPostgresPlatformContext({
      sql: sqlB,
      transaction: sqlB,
      overlay,
      secrets,
      ingestionPageSize: 1,
    });
    const { app: app2 } = await createPlatformServer(reopened);
    await reopened.ingestion.startPull({
      connectorId: 'csv-resume',
      mappingId,
      ontologyId,
      principal: 'svc',
    });
    await reopened.ingestionWorker.drainOnce();
    const secondRow = await app2.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/2`,
      headers: { 'x-principal': 'svc' },
    });
    expect(secondRow.statusCode).toBe(200);
    expect(secondRow.json().properties['pt.name']).toBe('second');
    await app2.close();
    await reopened.close?.();
  });
});
