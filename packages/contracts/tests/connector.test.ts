/**
 * contracts — tests/connector.test.ts
 * Shape mínima do Connector API.
 */

import { describe, expect, it } from 'vitest';

import type { Capability, Connector, Cursor } from '../src/v1/connector.js';

describe('Connector API types', () => {
  it('capabilities incluem snapshot|cdc|pushdown|subscribe|writeback', () => {
    const caps: Capability[] = ['snapshot', 'cdc', 'pushdown', 'subscribe', 'writeback'];
    expect(caps).toHaveLength(5);
  });

  it('federatedQuery é opcional no Connector (capability pushdown)', async () => {
    const stub: Connector = {
      connectorId: 'fed',
      capabilities: ['pushdown'],
      async discover() {
        return [];
      },
      async schema() {
        return {
          object: { sourceSystem: 'x', objectName: 'y' },
          columns: [],
          schemaVersion: '1',
        };
      },
      async *snapshot() {},
      async *read() {},
      async checkpoint() {
        return { token: '' };
      },
      async health() {
        return { state: 'ok', checkedAt: '2024-01-01T00:00:00.000Z' };
      },
      async federatedQuery(spec) {
        return { object: spec.object, rows: [], copied: false, pushedDown: true };
      },
    };
    const result = await stub.federatedQuery!({
      object: { sourceSystem: 'x', objectName: 'y' },
      primaryKeys: ['1'],
    });
    expect(result.copied).toBe(false);
    expect(result.pushedDown).toBe(true);
  });

  it('subscribe é opcional no Connector (capability subscribe)', async () => {
    const stub: Connector = {
      connectorId: 'edge',
      capabilities: ['subscribe'],
      async discover() {
        return [];
      },
      async schema() {
        return {
          object: { sourceSystem: 'edge', objectName: 'events' },
          columns: [],
          schemaVersion: '1',
        };
      },
      async *snapshot() {},
      async *read() {},
      async checkpoint() {
        return { token: '' };
      },
      async health() {
        return { state: 'ok', checkedAt: '2024-01-01T00:00:00.000Z' };
      },
      async *subscribe() {},
    };
    const rows: unknown[] = [];
    for await (const ev of stub.subscribe!()) rows.push(ev);
    expect(rows).toEqual([]);
  });

  it('Cursor é opaco (token string)', () => {
    const cursor: Cursor = { token: '{"kind":"empty"}' };
    expect(typeof cursor.token).toBe('string');
  });

  it('Connector exige connectorId + capabilities', async () => {
    const stub: Connector = {
      connectorId: 'stub',
      capabilities: ['snapshot'],
      async discover() {
        return [];
      },
      async schema() {
        return {
          object: { sourceSystem: 'x', objectName: 'y' },
          columns: [],
          schemaVersion: '1',
        };
      },
      async *snapshot() {},
      async *read() {},
      async checkpoint() {
        return { token: '' };
      },
      async health() {
        return { state: 'ok', checkedAt: '2024-01-01T00:00:00.000Z' };
      },
    };
    expect(stub.connectorId).toBe('stub');
    expect(await stub.health()).toMatchObject({ state: 'ok' });
  });
});
