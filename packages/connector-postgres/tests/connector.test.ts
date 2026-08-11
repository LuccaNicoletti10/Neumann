/**
 * connector-postgres — tests/connector.test.ts
 */

import { describe, expect, it } from 'vitest';

import { createMemoryCheckpointStore, runIncremental, runSnapshot } from 'connector-sdk';
import type { ObjectRef } from 'contracts';
import { assertConnectorShape } from 'connector-sdk';

import { makeClient, makeConnector, seedPeople } from './helpers.js';

const OBJ: ObjectRef = { sourceSystem: 'crm', objectName: 'people' };

describe('createPostgresConnector', () => {
  it('capabilities = snapshot + cdc e passa validate', async () => {
    const c = makeConnector(makeClient(3));
    expect(c.capabilities).toEqual(['snapshot', 'cdc']);
    assertConnectorShape(c);
    expect((await c.health()).state).toBe('ok');
  });

  it('discover + schema', async () => {
    const c = makeConnector(makeClient(2));
    const objects = await c.discover();
    expect(objects).toEqual([{ name: 'people', sourceSystem: 'crm', kind: 'table' }]);
    const schema = await c.schema(OBJ);
    expect(schema.columns.some((col) => col.isPrimaryKey)).toBe(true);
    expect(schema.columns.map((col) => col.name)).toContain('updated_at');
  });

  it('snapshot emite CanonicalEvents paginados com payload_hash', async () => {
    const c = makeConnector(makeClient(5), { pageSize: 2 });
    const events = [];
    for await (const e of c.snapshot(OBJ)) events.push(e);
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.source_primary_key)).toEqual(['1', '2', '3', '4', '5']);
    for (const e of events) {
      expect(e.payload_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(e.connector_id).toBe('pg-test');
      expect(e.checkpoint.length).toBeGreaterThan(0);
    }
  });

  it('read (CDC) detecta updates e deletes (tombstone)', async () => {
    const client = makeClient(3);
    const c = makeConnector(client, { pageSize: 10 });

    // snapshot completo primeiro
    for await (const _ of c.snapshot(OBJ)) {
      /* drain */
    }
    const afterSnap = await c.checkpoint();

    // update + soft-delete
    client.upsert([
      {
        id: '2',
        name: 'Person 2b',
        email: 'p2b@example.com',
        updated_at: '2025-01-01T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: '3',
        name: 'Person 3',
        email: 'p3@example.com',
        updated_at: '2025-01-01T00:00:01.000Z',
        deleted_at: '2025-01-01T00:00:01.000Z',
      },
    ]);

    // Novo connector com cursor pós-snapshot: usar cdc a partir de updated_at do último seed
    // Após snapshot lastPk=3; read com cursor snapshot inicia CDC fraco.
    // Para teste determinístico: cursor cdc com updatedAt = último seed (id=3 timestamp).
    const seed = seedPeople(3);
    const last = seed[seed.length - 1]!;
    const cdcConnector = makeConnector(client, {
      pageSize: 10,
      initialCursorToken: JSON.stringify({
        kind: 'cdc',
        object: 'people',
        updatedAt: last.updated_at,
        lastPk: last.id,
      }),
    });

    const changes = [];
    for await (const e of cdcConnector.read({
      token: JSON.stringify({
        kind: 'cdc',
        object: 'people',
        updatedAt: last.updated_at,
        lastPk: last.id,
      }),
    })) {
      changes.push(e);
    }

    expect(changes.map((e) => e.source_primary_key).sort()).toEqual(['2', '3']);
    const del = changes.find((e) => e.source_primary_key === '3');
    expect(del?.payload.__deleted).toBe(true);
    expect(afterSnap.token).toContain('snapshot');
  });

  it('runIncremental após snapshot pega só mudanças', async () => {
    const client = makeClient(2);
    const store = createMemoryCheckpointStore();
    const connector = makeConnector(client, { pageSize: 50 });
    await runSnapshot({ connector, store, object: OBJ });

    client.upsert([
      {
        id: '1',
        name: 'Updated',
        email: 'u@example.com',
        updated_at: '2030-01-01T00:00:00.000Z',
        deleted_at: null,
      },
    ]);

    // Para CDC após snapshot: gravar cursor cdc no watermark do seed
    const seed = seedPeople(2);
    const last = seed[seed.length - 1]!;
    await store.set('pg-test', 'people', {
      token: JSON.stringify({
        kind: 'cdc',
        object: 'people',
        updatedAt: last.updated_at,
        lastPk: last.id,
      }),
    });

    const cdc = makeConnector(client);
    const result = await runIncremental({ connector: cdc, store, object: OBJ });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.source_primary_key).toBe('1');
    expect(result.events[0]?.payload.name).toBe('Updated');
  });
});
