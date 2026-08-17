/**
 * connector-postgres — v2 protocol wrapper (CONNECTOR_PROTOCOL=v2).
 */
import { describe, expect, it } from 'vitest';

import { asConnectorV2 } from 'connector-sdk';

import { makeClient, makeConnector } from './helpers.js';

describe('connector-postgres v2', () => {
  it('asConnectorV2 SPEC/CHECK/DISCOVER/READ', async () => {
    const v1 = makeConnector(makeClient(3));
    const v2 = asConnectorV2(v1, '2.0.0');
    const spec = await v2.spec();
    expect(spec.connectorId).toBe('pg-test');
    expect(spec.version).toBe('2.0.0');
    expect((await v2.check()).ok).toBe(true);
    const streams = await v2.discover();
    expect(streams.length).toBeGreaterThanOrEqual(1);
    const records: unknown[] = [];
    for await (const msg of v2.read({ fullRefresh: true })) {
      if (msg.type === 'RECORD') records.push(msg.record);
      if (msg.type === 'ERROR') throw new Error(msg.message);
    }
    expect(records.length).toBe(3);
  });
});
