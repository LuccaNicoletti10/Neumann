/**
 * connector-sdk — tests/sdk.test.ts
 */

import { describe, expect, it } from 'vitest';

import type { CanonicalEvent, Connector, ObjectRef } from 'contracts';

import { createMemoryCheckpointStore } from '../src/core/checkpoint-store.js';
import { createFixedClock, createIdGenerator } from '../src/core/determinism.js';
import { createEventFactory } from '../src/core/event-factory.js';
import { runIncremental, runSnapshot } from '../src/core/runner.js';
import { assertConnectorShape, validateConnectorShape } from '../src/core/validate.js';

function makeStub(events: CanonicalEvent[]): Connector {
  let lastCheckpoint = '';
  return {
    connectorId: 'stub',
    capabilities: ['snapshot', 'cdc'],
    async discover() {
      return [{ name: 'people', sourceSystem: 'crm' }];
    },
    async schema(obj) {
      return {
        object: obj,
        columns: [{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true }],
        schemaVersion: '1',
      };
    },
    async *snapshot() {
      for (const e of events) {
        lastCheckpoint = e.checkpoint;
        yield e;
      }
    },
    async *read(cursor) {
      const start = cursor.token ? Number(cursor.token) : 0;
      for (let i = start; i < events.length; i += 1) {
        const e = events[i]!;
        lastCheckpoint = String(i + 1);
        yield { ...e, checkpoint: lastCheckpoint };
      }
    },
    async checkpoint() {
      return { token: lastCheckpoint };
    },
    async health() {
      return { state: 'ok', checkedAt: '2024-01-01T00:00:00.000Z' };
    },
  };
}

describe('connector-sdk', () => {
  it('createEventFactory preenche payload_hash', () => {
    const factory = createEventFactory({
      clock: createFixedClock('2024-01-01T00:00:00.000Z'),
      nextId: createIdGenerator(),
    });
    const event = factory.create({
      source_system: 'crm',
      source_object: 'people',
      source_primary_key: '1',
      schema_version: '1',
      connector_id: 'stub',
      checkpoint: 'c1',
      principal: 'sa',
      payload: { id: 1 },
    });
    expect(event.event_id).toBe('evt-1');
    expect(event.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.ingested_at).toBe('2024-01-01T00:00:00.000Z');
  });

  it('validateConnectorShape detecta falhas', () => {
    const bad = {
      connectorId: '',
      capabilities: [],
    } as unknown as Connector;
    const result = validateConnectorShape(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('assertConnectorShape passa no stub válido', () => {
    const stub = makeStub([]);
    expect(() => assertConnectorShape(stub)).not.toThrow();
  });

  it('CheckpointStore memória get/set/delete', async () => {
    const store = createMemoryCheckpointStore();
    expect(await store.get('a', 'people')).toBeNull();
    await store.set('a', 'people', { token: 't1' });
    expect(await store.get('a', 'people')).toEqual({ token: 't1' });
    await store.delete('a', 'people');
    expect(await store.get('a', 'people')).toBeNull();
  });

  it('runSnapshot abortAfter persiste checkpoint e permite retomar', async () => {
    const factory = createEventFactory({
      clock: createFixedClock('2024-01-01T00:00:00.000Z'),
      nextId: createIdGenerator(),
    });
    const events = [1, 2, 3, 4, 5].map((id) =>
      factory.create({
        source_system: 'crm',
        source_object: 'people',
        source_primary_key: String(id),
        schema_version: '1',
        connector_id: 'stub',
        checkpoint: String(id),
        principal: 'sa',
        payload: { id },
      }),
    );
    const store = createMemoryCheckpointStore();
    const object: ObjectRef = { sourceSystem: 'crm', objectName: 'people' };

    const first = await runSnapshot({
      connector: makeStub(events),
      store,
      object,
      abortAfter: 3,
    });
    expect(first.aborted).toBe(true);
    expect(first.events).toHaveLength(3);
    expect(first.checkpoint.token).toBe('3');

    // incremental a partir do checkpoint salvo (token = índice já consumido)
    const second = await runIncremental({
      connector: makeStub(events),
      store,
      object,
    });
    expect(second.events.map((e) => e.source_primary_key)).toEqual(['4', '5']);
  });
});
