/**
 * platform-api — HTTP logger spy. logger:false is not a redaction proof.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createMemorySecretResolver,
  webhookSignedPayload,
  type IngestionLogEvent,
} from 'ingestion-runtime';
import type { PolicyOverlay } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

const SECRET = 'SEN10C_SECRET_resolved_7f3a9c21';
const SIGNATURE = 'SEN10C_SIG_' + 'cd'.repeat(16);
const PAYLOAD = 'SEN10C_PAYLOAD_body_value_88e1';
const AUTH = 'Bearer SEN10C_AUTH_header_token_b17f';
const REF = 'connector:wh-log:webhook-secret';

const SENTINELS = [SECRET, SIGNATURE, PAYLOAD, AUTH];

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

describe('HTTP ingest logger redaction', () => {
  it('serializes every logger event without sentinels', async () => {
    const ingestionEvents: IngestionLogEvent[] = [];
    const httpChunks: string[] = [];
    const secrets = createMemorySecretResolver();
    secrets.set(REF, SECRET);
    const ctx = createMemoryPlatformContext({
      overlay,
      secrets,
      log: (event) => ingestionEvents.push(event),
    });
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
      connectorId: 'wh-log',
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
    const { app } = await createPlatformServer(ctx, {
      logDestination: { write: (msg) => httpChunks.push(msg) },
    });
    const timestamp = '2024-01-01T00:00:00.000Z';
    const raw = JSON.stringify({ id: 'h1', name: PAYLOAD });
    const headers = {
      'content-type': 'application/json',
      authorization: AUTH,
      'x-neumann-timestamp': timestamp,
    };

    await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-log',
      headers: {
        ...headers,
        'x-neumann-signature': sign(timestamp, 'n-ok', raw),
        'x-neumann-nonce': 'n-ok',
      },
      payload: raw,
    });
    await app.inject({
      method: 'POST',
      url: '/api/v2/ingest/wh-log',
      headers: {
        ...headers,
        'x-neumann-signature': SIGNATURE,
        'x-neumann-nonce': 'n-bad',
      },
      payload: raw,
    });
    await app.close();

    const blob = JSON.stringify({ ingestionEvents, httpChunks });
    for (const sentinel of SENTINELS) {
      expect(blob).not.toContain(sentinel);
    }
    expect(ingestionEvents.some((e) => e.code === 'INGESTION_ACCEPTED')).toBe(true);
    expect(ingestionEvents.some((e) => e.code === 'WEBHOOK_AUTH')).toBe(true);

    const { serializeHttpLogError, serializeHttpLogRequest, writeRedactedHttpLog } = await import(
      '../src/core/http-log.js'
    );
    expect(serializeHttpLogRequest({ method: 'POST', url: '/api/v2/ingest/wh-log' })).toEqual({
      method: 'POST',
      url: '/api/v2/ingest/wh-log',
    });
    expect(serializeHttpLogError({ name: 'Error', message: PAYLOAD, stack: AUTH, code: 'E' })).toEqual({
      type: 'Error',
      message: '[redacted]',
      stack: '',
      code: 'E',
    });
    const lines: string[] = [];
    writeRedactedHttpLog({ write: (msg) => lines.push(msg) }, JSON.stringify({ nested: { secret: PAYLOAD } }));
    writeRedactedHttpLog({ write: (msg) => lines.push(msg) }, 'not-json');
    expect(lines.join('')).not.toContain(PAYLOAD);
    expect(lines.some((line) => line.includes('not-json'))).toBe(true);
  });
});
