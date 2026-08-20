/**
 * ingestion-runtime — spy-logger redaction. logger:false is not a proof.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createMemoryCheckpointStore } from 'connector-sdk';

import {
  createConnectorRegistry,
  createIngestionRuntime,
  createMemoryIngestionStore,
  createMemorySecretResolver,
  redactLogValue,
  webhookSecretKey,
  webhookSignedPayload,
  type EnvelopeSource,
  type IngestionLogEvent,
} from '../src/index.js';
import { allow, makeHarness } from './harness.js';

const SECRET = 'SEN10C_SECRET_resolved_7f3a9c21';
const SIGNATURE = 'SEN10C_SIG_' + 'ab'.repeat(16);
const PAYLOAD = 'SEN10C_PAYLOAD_body_value_88e1';
const CONFIG_NESTED = 'SEN10C_NESTED_cfg_secret_c4d2';
const CONNECTOR_ERR = 'SEN10C_CONNECTOR_boom_msg_91aa';
const AUTH = 'SEN10C_AUTH_header_token_b17f';

const SENTINELS = [SECRET, SIGNATURE, PAYLOAD, CONFIG_NESTED, CONNECTOR_ERR, AUTH];

function dump(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => nested);
}

function assertNoSentinels(value: unknown): void {
  const text = dump(value);
  for (const sentinel of SENTINELS) {
    expect(text).not.toContain(sentinel);
  }
}

describe('ingestion log redaction', () => {
  it('redacts nested sensitive config keys without copying values', () => {
    const nested = {
      outer: {
        secret: CONFIG_NESTED,
        password: CONFIG_NESTED,
        token: CONFIG_NESTED,
        authorization: AUTH,
        apiKey: CONFIG_NESTED,
        clientSecret: CONFIG_NESTED,
      },
    };
    const redacted = redactLogValue(nested);
    assertNoSentinels(redacted);
    const rec = redacted as { outer: Record<string, string> };
    expect(rec.outer.secret).toBe('[redacted]');
    expect(rec.outer.password).toBe('[redacted]');
    expect(rec.outer.token).toBe('[redacted]');
    expect(rec.outer.authorization).toBe('[redacted]');
    expect(rec.outer.apiKey).toBe('[redacted]');
    expect(rec.outer.clientSecret).toBe('[redacted]');
  });

  it('spy logger never records sentinels across ingest outcomes', async () => {
    const events: IngestionLogEvent[] = [];
    const secrets = createMemorySecretResolver();
    secrets.set(webhookSecretKey('webhook'), SECRET);
    const h = await makeHarness({ secrets });
    const store = createMemoryIngestionStore();
    const failing: EnvelopeSource = {
      connectorId: 'boom',
      pullPage: async () => {
        throw new Error(CONNECTOR_ERR);
      },
    };
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: {
        getVersion: async (id) => h.platform.getMappingVersion(id),
        getLatest: async (id) => h.platform.getLatestMappingVersion(id),
      },
      connectors: createConnectorRegistry([failing]),
      store,
      checkpoints: createMemoryCheckpointStore(),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: () => '2024-01-01T00:00:00.000Z',
      nextId: h.nextId,
      secrets,
      log: (event) => events.push(event),
    });
    const raw = JSON.stringify({ id: 'w1', name: PAYLOAD });
    const timestamp = '2024-01-01T00:00:00.000Z';
    const signed = (nonce: string, body: string) =>
      createHmac('sha256', SECRET).update(webhookSignedPayload(timestamp, nonce, body)).digest('hex');

    const ok = await runtime.enqueueWebhook({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      rawBody: raw,
      signature: signed('n-ok', raw),
      timestamp,
      nonce: 'n-ok',
    });
    await runtime.runOnce(ok.id);

    await expect(
      runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: raw,
        signature: SIGNATURE,
        timestamp,
        nonce: 'n-bad',
      }),
    ).rejects.toThrow();

    await expect(
      runtime.enqueueWebhook({
        connectorId: 'webhook',
        mappingId: h.mapping.id,
        ontologyId: h.ontologyId,
        principal: 'svc',
        rawBody: JSON.stringify({ id: 'w1', name: 'other' }),
        signature: signed('n-div', JSON.stringify({ id: 'w1', name: 'other' })),
        timestamp,
        nonce: 'n-div',
      }),
    ).rejects.toThrow();

    const pull = await runtime.startPull({
      connectorId: 'boom',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const failed = await runtime.runOnce(pull.id);
    expect(failed.status).toBe('failed');

    const quarantined = await runtime.enqueueWebhook({
      connectorId: 'webhook',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      envelope: {
        connectorId: 'webhook',
        source: 'webhook',
        sourceEventId: 'q-bad',
        occurredAt: timestamp,
        payload: { name: PAYLOAD },
        metadata: {},
      },
    });
    await runtime.runOnce(quarantined.id);
    const [entry] = await store.listQuarantine(quarantined.id);
    expect(entry).toBeTruthy();
    await runtime.retryQuarantined({ quarantineId: entry!.id, principal: 'svc' });

    assertNoSentinels(events);
    const codes = new Set(events.map((e) => e.code));
    expect(codes.has('INGESTION_ACCEPTED')).toBe(true);
    expect(codes.has('WEBHOOK_AUTH')).toBe(true);
    expect(codes.has('INGESTION_EVENT_CONFLICT')).toBe(true);
    expect(codes.has('INGESTION_RUN_FAILED')).toBe(true);
    expect(codes.has('INGESTION_QUARANTINED')).toBe(true);
    expect(codes.has('INGESTION_RETRY')).toBe(true);
    for (const event of events) {
      expect(Object.keys(event).every((k) =>
        ['code', 'runId', 'connectorId', 'sourceEventId', 'mappingVersionId', 'hash', 'count', 'errorName', 'errorCode'].includes(k),
      )).toBe(true);
    }
  });
});
