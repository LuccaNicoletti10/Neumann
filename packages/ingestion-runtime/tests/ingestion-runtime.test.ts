/**
 * ingestion-runtime — pin, lease, quarantine, deny, transform.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createConnectorRegistry,
  createIngestionRuntime,
  createMemoryIngestionStore,
  createMemorySecretResolver,
  IngestionDeniedError,
  IngestionEventConflictError,
  IngestionLeaseHeldError,
  MappingTransformError,
  PayloadTooLargeError,
  sourceFromEnvelopes,
  WebhookAuthenticationError,
  WebhookNonceReuseError,
  webhookSecretKey,
  webhookSignedPayload,
} from '../src/index.js';
import { createMemoryCheckpointStore } from 'connector-sdk';

import { allow, deny, makeHarness } from './harness.js';

describe('IngestionRuntime', () => {
  it('pulls envelopes through a pinned mapping into ProjectionWriter', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    expect(run.pin.mappingVersionId).toBe(h.platform.getLatestMappingVersion(h.mapping.id)!.id);
    const done = await h.runtime.runOnce(run.id);
    expect(done.status).toBe('completed');
    expect(done.processedCount).toBe(1);
    const obj = await h.objects.get(h.ontologyId, 'ot.item', '1');
    expect(obj?.properties['pt.name']).toBe('alpha');
    expect(obj?.ontologyVersionId).toBe(h.v1.id);
  });

  it('does not re-resolve latest after the run is pinned', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const pinned = run.pin.mappingVersionId;
    h.platform.openMappingDraft(h.mapping.id);
    const draft = h.platform.openMappingDraft(h.mapping.id);
    h.platform.setMappingDraft(h.mapping.id, {
      ...draft,
      propertyMappings: [
        ...draft.propertyMappings,
        { sourceField: 'extra', propertyTypeId: 'pt.extra', transform: 'string' },
      ],
    });
    h.platform.commitMapping({ mappingId: h.mapping.id, createdBy: 'test' });
    const latest = h.platform.getLatestMappingVersion(h.mapping.id)!;
    expect(latest.id).not.toBe(pinned);
    const done = await h.runtime.runOnce(run.id);
    expect(done.pin.mappingVersionId).toBe(pinned);
    expect(done.status).toBe('completed');
    const obj = await h.objects.get(h.ontologyId, 'ot.item', '1');
    expect(obj?.properties['pt.extra']).toBeUndefined();
    expect(obj?.properties['pt.name']).toBe('alpha');
  });

  it('quarantines an envelope missing the primary key and writes nothing', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'bad',
        occurredAt: 't0',
        payload: { name: 'no-id' },
        metadata: {},
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const done = await h.runtime.runOnce(run.id);
    expect(done.quarantinedCount).toBe(1);
    expect(done.processedCount).toBe(0);
    expect(await h.objects.get(h.ontologyId, 'ot.item', '')).toBeUndefined();
  });

  it('replays the same sourceEventId and rejects a divergent payload', async () => {
    const envelope = {
      connectorId: 'csv',
      source: 'file',
      sourceEventId: 'e1',
      occurredAt: 't0',
      payload: { id: '1', name: 'alpha' },
      metadata: { checkpoint: '1' },
    };
    const h = await makeHarness();
    const first = await h.runtime.enqueueWebhook({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      envelope,
    });
    const applied = await h.runtime.runOnce(first.id);
    expect(applied.processedCount).toBe(1);

    const replay = await h.runtime.enqueueWebhook({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      envelope,
      nonce: 'n-replay',
    });
    expect(replay.id).toBe(first.id);
    expect(replay.replayed).toBe(true);
    const replayed = await h.runtime.runOnce(replay.id);
    expect(replayed.processedCount).toBe(1);
    expect(replayed.quarantinedCount).toBe(0);

    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'csv',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        envelope,
        nonce: 'n-replay',
      }),
    ).rejects.toBeInstanceOf(WebhookNonceReuseError);

    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'csv',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        envelope: { ...envelope, payload: { id: '1', name: 'beta' } },
      }),
    ).rejects.toBeInstanceOf(IngestionEventConflictError);
    const obj = await h.objects.get(h.ontologyId, 'ot.item', '1');
    expect(obj?.properties['pt.name']).toBe('alpha');
  });

  it('retryQuarantined keeps the original pin, not latest', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'bad',
        occurredAt: 't0',
        payload: { name: 'no-id' },
        metadata: {},
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    await h.runtime.runOnce(run.id);
    const pin = run.pin.mappingVersionId;
    const [quarantined] = await h.store.listQuarantine(run.id);
    expect(quarantined?.pin.mappingVersionId).toBe(pin);
    const retry = await h.runtime.retryQuarantined({
      quarantineId: quarantined!.id,
      principal: 'svc',
    });
    expect(retry.pin.mappingVersionId).toBe(pin);
    expect(retry.kind).toBe('retry');
  });

  it('concurrent runOnce: exactly one worker holds the lease', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const store = createMemoryIngestionStore();
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: {
        getVersion: async (id) => h.platform.getMappingVersion(id),
        getLatest: async (id) => h.platform.getLatestMappingVersion(id),
      },
      connectors: createConnectorRegistry([source]),
      store,
      checkpoints: createMemoryCheckpointStore(),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: () => '2024-01-01T00:00:00.000Z',
      nextId: h.nextId,
      leaseMs: 60_000,
    });
    const started = await runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    await store.acquireLease({
      runId: started.id,
      workerId: 'holder',
      leaseUntil: '2024-01-01T00:01:00.000Z',
      now: '2024-01-01T00:00:00.000Z',
    });
    await expect(runtime.runOnce(started.id)).rejects.toBeInstanceOf(IngestionLeaseHeldError);
  });

  it('deny writes nothing', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: {},
      },
    ]);
    const h = await makeHarness({ sources: [source], authorize: deny });
    await expect(
      h.runtime.startPull({
        connectorId: 'csv',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
      }),
    ).rejects.toBeInstanceOf(IngestionDeniedError);
  });

  it('partial writes nothing', async () => {
    const partial = (): ReturnType<typeof deny> => ({
      decision: 'partial',
      principalEpids: [],
      resourceEpid: null,
      reason: 'partial',
    });
    const h = await makeHarness({ authorize: partial });
    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'csv',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        envelope: {
          connectorId: 'csv',
          source: 'file',
          sourceEventId: 'e1',
          occurredAt: 't0',
          payload: { id: '1', name: 'alpha' },
          metadata: {},
        },
      }),
    ).rejects.toBeInstanceOf(IngestionDeniedError);
    expect(await h.objects.get(h.ontologyId, 'ot.item', '1')).toBeUndefined();
  });

  it('webhook HMAC: matching signature enqueues, mismatch is rejected', async () => {
    const secrets = createMemorySecretResolver();
    secrets.set(webhookSecretKey('webhook'), 'whsec_test');
    const h = await makeHarness({ secrets });
    const raw = JSON.stringify({ id: 'w1', name: 'from-hook' });
    const timestamp = h.clock();
    const nonce = 'nonce-1';
    const signature = createHmac('sha256', 'whsec_test')
      .update(webhookSignedPayload(timestamp, nonce, raw))
      .digest('hex');
    const run = await h.runtime.enqueueWebhook({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      rawBody: raw,
      signature,
      timestamp,
      nonce,
    });
    const done = await h.runtime.runOnce(run.id);
    expect(done.processedCount).toBe(1);
    expect((await h.objects.get(h.ontologyId, 'ot.item', 'w1'))?.properties['pt.name']).toBe(
      'from-hook',
    );
    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: '00'.repeat(32),
        timestamp,
        nonce: 'nonce-2',
      }),
    ).rejects.toBeInstanceOf(WebhookAuthenticationError);
  });

  it('startPull fails closed on an unknown connector', async () => {
    const h = await makeHarness();
    await expect(
      h.runtime.startPull({
        connectorId: 'missing',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
      }),
    ).rejects.toBeInstanceOf(MappingTransformError);
  });

  it('retries a transient ProjectionWriter failure then succeeds', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    let attempts = 0;
    const inner = h.writer.projectBatch.bind(h.writer);
    h.writer.projectBatch = async (cmd) => {
      attempts += 1;
      if (attempts < 2) throw new Error('transient');
      return inner(cmd);
    };
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const done = await h.runtime.runOnce(run.id);
    expect(attempts).toBe(2);
    expect(done.status).toBe('completed');
    expect(done.processedCount).toBe(1);
  });

  it('pins an explicit mappingVersionId even when latest differs', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: {},
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const first = h.platform.getLatestMappingVersion(h.mapping.id)!;
    h.platform.openMappingDraft(h.mapping.id);
    const draft = h.platform.openMappingDraft(h.mapping.id);
    h.platform.setMappingDraft(h.mapping.id, {
      ...draft,
      propertyMappings: [
        ...draft.propertyMappings,
        { sourceField: 'extra', propertyTypeId: 'pt.extra', transform: 'string' },
      ],
    });
    h.platform.commitMapping({ mappingId: h.mapping.id, createdBy: 'test' });
    const run = await h.runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      mappingVersionId: first.id,
    });
    expect(run.pin.mappingVersionId).toBe(first.id);
    const done = await h.runtime.runOnce(run.id);
    expect((await h.objects.get(h.ontologyId, 'ot.item', '1'))?.properties['pt.extra']).toBeUndefined();
    expect(done.status).toBe('completed');
  });

  it('rejects expired timestamp, reused nonce, oversized body, and reserialized HMAC', async () => {
    const secrets = createMemorySecretResolver();
    secrets.set(webhookSecretKey('webhook'), 'whsec_test');
    const h = await makeHarness({ secrets });
    const raw = '{ "id": "w1", "name": "from-hook" }';
    const timestamp = h.clock();
    const signed = (ts: string, nonce: string, body: string) =>
      createHmac('sha256', 'whsec_test').update(webhookSignedPayload(ts, nonce, body)).digest('hex');

    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: signed(timestamp, 'n-exp', raw),
        timestamp: '2000-01-01T00:00:00.000Z',
        nonce: 'n-exp',
      }),
    ).rejects.toBeInstanceOf(WebhookAuthenticationError);

    const ok = await h.runtime.enqueueWebhook({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      rawBody: raw,
      signature: signed(timestamp, 'n-ok', raw),
      timestamp,
      nonce: 'n-ok',
    });
    expect(ok.replayed).toBe(false);

    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: JSON.stringify({ id: 'w2', name: 'other' }),
        signature: signed(timestamp, 'n-ok', JSON.stringify({ id: 'w2', name: 'other' })),
        timestamp,
        nonce: 'n-ok',
      }),
    ).rejects.toBeInstanceOf(WebhookNonceReuseError);

    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);
    const tight = createIngestionRuntime({
      projections: h.writer,
      catalog: {
        getVersion: async (id) => h.platform.getMappingVersion(id),
        getLatest: async (id) => h.platform.getLatestMappingVersion(id),
      },
      connectors: createConnectorRegistry([]),
      store: createMemoryIngestionStore(),
      checkpoints: createMemoryCheckpointStore(),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: h.clock,
      nextId: h.nextId,
      secrets,
      maxBodyBytes: 8,
    });
    await expect(
      tight.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: signed(h.clock(), 'n-big', raw),
        timestamp: h.clock(),
        nonce: 'n-big',
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);

    await expect(
      h.runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: signed(timestamp, 'n-reser', reserialized),
        timestamp,
        nonce: 'n-reser',
      }),
    ).rejects.toBeInstanceOf(WebhookAuthenticationError);
  });

  it('crash after projection before checkpoint does not duplicate', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const checkpoints = createMemoryCheckpointStore();
    let crash = true;
    const inner = checkpoints.set.bind(checkpoints);
    checkpoints.set = async (connectorId, objectName, cursor) => {
      if (crash) {
        crash = false;
        throw new Error('crash after projection');
      }
      return inner(connectorId, objectName, cursor);
    };
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: {
        getVersion: async (id) => h.platform.getMappingVersion(id),
        getLatest: async (id) => h.platform.getLatestMappingVersion(id),
      },
      connectors: createConnectorRegistry([source]),
      store: createMemoryIngestionStore(),
      checkpoints,
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: () => '2024-01-01T00:00:00.000Z',
      nextId: h.nextId,
    });
    const run = await runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const failed = await runtime.runOnce(run.id);
    expect(failed.status).toBe('failed');
    expect((await h.objects.get(h.ontologyId, 'ot.item', '1'))?.properties['pt.name']).toBe('alpha');
    const retried = await runtime.runOnce(run.id);
    expect(retried.status).toBe('completed');
    expect((await h.objects.get(h.ontologyId, 'ot.item', '1'))?.properties['pt.name']).toBe('alpha');
  });

  it('same event + new nonce replays; reused nonce and expired timestamp after purge fail closed', async () => {
    let nowMs = Date.parse('2024-01-01T00:00:00.000Z');
    const clock = () => new Date(nowMs).toISOString();
    const secrets = createMemorySecretResolver();
    secrets.set(webhookSecretKey('webhook'), 'whsec_test');
    const h = await makeHarness({ secrets });
    const store = createMemoryIngestionStore();
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: {
        getVersion: async (id) => h.platform.getMappingVersion(id),
        getLatest: async (id) => h.platform.getLatestMappingVersion(id),
      },
      connectors: createConnectorRegistry([]),
      store,
      checkpoints: createMemoryCheckpointStore(),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock,
      nextId: h.nextId,
      secrets,
    });
    const raw = JSON.stringify({ id: 'ttl1', name: 'alpha' });
    const signed = (ts: string, nonce: string) =>
      createHmac('sha256', 'whsec_test').update(webhookSignedPayload(ts, nonce, raw)).digest('hex');
    const ts = clock();
    const first = await runtime.enqueueWebhook({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      rawBody: raw,
      signature: signed(ts, 'n-ttl'),
      timestamp: ts,
      nonce: 'n-ttl',
    });
    expect(first.replayed).toBe(false);
    const replay = await runtime.enqueueWebhook({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      rawBody: raw,
      signature: signed(ts, 'n-ttl-2'),
      timestamp: ts,
      nonce: 'n-ttl-2',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);

    const beforeExpiry = await store.purgeExpiredNonces(clock());
    expect(beforeExpiry).toBe(0);
    await expect(
      runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: signed(ts, 'n-ttl'),
        timestamp: ts,
        nonce: 'n-ttl',
      }),
    ).rejects.toBeInstanceOf(WebhookNonceReuseError);

    nowMs += 11 * 60 * 1000;
    const purged = await store.purgeExpiredNonces(clock());
    expect(purged).toBeGreaterThan(0);
    await expect(
      runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: signed(ts, 'n-ttl'),
        timestamp: ts,
        nonce: 'n-ttl',
      }),
    ).rejects.toBeInstanceOf(WebhookAuthenticationError);
  });
});

