/**
 * ingestion-runtime — CSV / HTTP / webhook connectors produce envelopes only.
 */
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { createCsvConnector } from 'connector-csv';
import { createHttpConnector } from 'connector-http';
import { createWebhookConnector, verifyWebhookSignature } from 'connector-webhook';

import { sourceFromConnectorV2, verifyHmacSha256 } from '../src/index.js';
import { makeHarness } from './harness.js';

describe('connectors through IngestionRuntime', () => {
  it('CSV file → objects via ProjectionWriter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'neumann-ing-csv-'));
    const path = join(dir, 'items.csv');
    writeFileSync(path, 'id,name\n10,csv-row\n');
    const connector = createCsvConnector({ path, connectorId: 'csv' });
    const source = sourceFromConnectorV2(connector, 'csv');
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const done = await h.runtime.runOnce(run.id);
    expect(done.status).toBe('completed');
    expect((await h.objects.get(h.ontologyId, 'ot.item', '10'))?.properties['pt.name']).toBe(
      'csv-row',
    );
  });

  it('HTTP JSON → objects via injected transport', async () => {
    const connector = createHttpConnector({
      url: 'http://ingestion-test/items',
      connectorId: 'http',
      fetchImpl: async () =>
        new Response(JSON.stringify([{ id: 'h1', name: 'http-row' }]), { status: 200 }),
    });
    const source = sourceFromConnectorV2(connector, 'http');
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'http',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const done = await h.runtime.runOnce(run.id);
    expect(done.status).toBe('completed');
    expect((await h.objects.get(h.ontologyId, 'ot.item', 'h1'))?.properties['pt.name']).toBe(
      'http-row',
    );
  });

  it('webhook connector records become envelopes; HMAC matches runtime verifier', () => {
    const raw = '{"id":"e1"}';
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, secret, signature)).toBe(true);
    expect(verifyHmacSha256(raw, secret, signature)).toBe(true);
    const connector = createWebhookConnector({
      secret,
      events: [{ id: 'e1', name: 'hook' }],
      connectorId: 'webhook',
    });
    expect(connector).toBeDefined();
  });

  it('webhook connector stream is ingested like any other EnvelopeSource', async () => {
    const connector = createWebhookConnector({
      secret: 'whsec_test',
      events: [{ id: 'w2', name: 'streamed' }],
      connectorId: 'webhook',
    });
    const source = sourceFromConnectorV2(connector, 'webhook');
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const done = await h.runtime.runOnce(run.id);
    expect(done.processedCount).toBe(1);
    expect((await h.objects.get(h.ontologyId, 'ot.item', 'w2'))?.properties['pt.name']).toBe(
      'streamed',
    );
  });
});
