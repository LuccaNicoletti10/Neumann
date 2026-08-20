/**
 * connector-webhook — event conversion, HMAC signature, invalid input.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createWebhookConnector, verifyWebhookSignature } from '../src/index.js';

async function collect(connector: ReturnType<typeof createWebhookConnector>) {
  const records: Array<{ payload: Record<string, unknown>; checkpoint?: string }> = [];
  const errors: string[] = [];
  for await (const msg of connector.read({ fullRefresh: true })) {
    if (msg.type === 'RECORD') {
      records.push({
        payload: msg.record.payload as Record<string, unknown>,
        checkpoint: msg.record.checkpoint,
      });
    }
    if (msg.type === 'ERROR') errors.push(msg.message);
  }
  return { records, errors };
}

describe('verifyWebhookSignature', () => {
  it('accepts a matching HMAC and rejects a mismatch', () => {
    const raw = '{"id":"e1"}';
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, secret, signature)).toBe(true);
    expect(verifyWebhookSignature(raw, secret, '00'.repeat(32))).toBe(false);
  });
});

describe('createWebhookConnector', () => {
  it('converts inbound events into canonical records', async () => {
    const connector = createWebhookConnector({
      secret: 'whsec_test',
      events: [
        { id: 'e1', type: 'created' },
        { id: 'e2', type: 'updated' },
      ],
    });
    const spec = await connector.spec();
    expect(spec.connectorId).toBe('webhook');
    const { records, errors } = await collect(connector);
    expect(errors).toEqual([]);
    expect(records.map((r) => r.payload)).toEqual([
      { id: 'e1', type: 'created' },
      { id: 'e2', type: 'updated' },
    ]);
    expect(records.map((r) => r.checkpoint)).toEqual(['1', '2']);
  });

  it('check rejects a missing secret', async () => {
    const connector = createWebhookConnector({ secret: '' });
    const check = await connector.check();
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/missing secret/);
  });
});
