/**
 * platform-api — thin POST /api/v2/ingest/:connectorId adapter (ADR-0017).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createMemorySecretResolver, webhookSignedPayload } from 'ingestion-runtime';
import type { PolicyOverlay } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

const SECRET = 'whsec_http';
const REF = 'connector:wh-http:webhook-secret';

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

async function seed(ctx: ReturnType<typeof createMemoryPlatformContext>) {
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
    mappingId: 'map-items',
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
    connectorId: 'wh-http',
    kind: 'webhook',
    enabled: true,
    config: { endpoint: 'erp' },
    secretRef: REF,
    servicePrincipal: 'svc',
    mappingId: mapping.mappingId,
    ontologyId: o.id,
    version: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  return o.id;
}

function sign(timestamp: string, nonce: string, raw: string): string {
  return createHmac('sha256', SECRET).update(webhookSignedPayload(timestamp, nonce, raw)).digest('hex');
}

describe('HTTP ingest webhook', () => {
  it('returns 202 only after enqueueWebhook and rejects a bad signature with zero inbox', async () => {
    const secrets = createMemorySecretResolver();
    secrets.set(REF, SECRET);
    const ctx = createMemoryPlatformContext({ overlay, secrets });
    const ontologyId = await seed(ctx);
    const { app } = await createPlatformServer(ctx);
    const timestamp = '2024-01-01T00:00:00.000Z';
    const raw = JSON.stringify({ id: 'h1', name: 'hooked' });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-http',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': '00'.repeat(32),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-bad',
      },
      payload: raw,
    });
    expect(bad.statusCode).toBe(401);
    const inboxAfterBad = await ctx.ingestion.getRun('missing');
    expect(inboxAfterBad).toBeUndefined();

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-http',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-ok', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-ok',
      },
      payload: raw,
    });
    expect(ok.statusCode).toBe(202);
    const body = ok.json() as { runId: string; sourceEventId: string; status: string };
    expect(body.status).toBe('accepted');
    expect(body.sourceEventId).toBe('h1');
    await ctx.ingestionWorker.drainOnce();
    const read = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item/h1`,
      headers: { 'x-principal': 'svc' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().properties['pt.name']).toBe('hooked');
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.item`,
      headers: { 'x-principal': 'svc' },
    });
    expect(listed.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-http',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-ok-2', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-ok-2',
      },
      payload: raw,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().runId).toBe(body.runId);
    expect(replay.json().status).toBe('replayed');

    const nonceReuse = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-http',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-ok', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-ok',
      },
      payload: raw,
    });
    expect(nonceReuse.statusCode).toBe(409);
    expect(nonceReuse.json().errorName).toBe('INGESTION_NONCE_REPLAY');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/no-such',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign(timestamp, 'n-miss', raw),
        'x-neumann-timestamp': timestamp,
        'x-neumann-nonce': 'n-miss',
      },
      payload: raw,
    });
    expect(missing.statusCode).toBe(404);

    const expired = await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-http',
      headers: {
        'content-type': 'application/json',
        'x-neumann-signature': sign('2000-01-01T00:00:00.000Z', 'n-exp', raw),
        'x-neumann-timestamp': '2000-01-01T00:00:00.000Z',
        'x-neumann-nonce': 'n-exp',
      },
      payload: raw,
    });
    expect(expired.statusCode).toBe(401);

    await app.close();
  });
});
