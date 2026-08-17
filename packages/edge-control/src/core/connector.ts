/**
 * edge-control — src/core/connector.ts
 * Fonte edge in-memory. subscribe/snapshot/read → CanonicalEvent.
 */

import {
  createDeterministicClock,
  createEventFactory,
  createIdGenerator,
  type EventFactory,
} from 'connector-sdk';
import type {
  CanonicalEvent,
  Connector,
  Cursor,
  EdgeSourceKind,
  ObjectRef,
} from 'contracts';
import { isEdgeSourceKind } from 'contracts';

export interface EdgeRecordInput {
  objectName: EdgeSourceKind;
  primaryKey: string;
  principal: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

export interface MemoryEdgeConnector extends Connector {
  push(input: EdgeRecordInput): CanonicalEvent;
  events: CanonicalEvent[];
}

export function createMemoryEdgeConnector(opts: {
  connectorId?: string;
  sourceSystem?: string;
  clock?: () => string;
  nextId?: (prefix: string) => string;
} = {}): MemoryEdgeConnector {
  const connectorId = opts.connectorId ?? 'edge';
  const sourceSystem = opts.sourceSystem ?? 'edge';
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const factory: EventFactory = createEventFactory({ clock, nextId, defaultPrincipal: 'sa:edge' });
  const events: CanonicalEvent[] = [];
  let seq = 0;

  function toEvent(input: EdgeRecordInput): CanonicalEvent {
    seq += 1;
    const objectName = isEdgeSourceKind(input.objectName) ? input.objectName : 'packetLog';
    return factory.create({
      source_system: sourceSystem,
      source_object: objectName,
      source_primary_key: input.primaryKey,
      schema_version: '1',
      connector_id: connectorId,
      checkpoint: String(seq),
      principal: input.principal,
      policy_tags: ['edge'],
      payload: { ...input.payload, kind: objectName },
      occurred_at: input.occurredAt,
    });
  }

  async function* fromIndex(start: number): AsyncIterable<CanonicalEvent> {
    for (let i = start; i < events.length; i += 1) {
      yield events[i]!;
    }
  }

  const connector: MemoryEdgeConnector = {
    connectorId,
    capabilities: ['snapshot', 'cdc', 'subscribe'],
    events,
    push(input) {
      const ev = toEvent(input);
      events.push(ev);
      return ev;
    },
    async discover() {
      const names = [...new Set(events.map((e) => e.source_object))];
      const list = names.length ? names : ['packetLog'];
      return list.map((name) => ({ name, sourceSystem, kind: 'edge' }));
    },
    async schema(obj: ObjectRef) {
      return {
        object: obj,
        columns: [
          { name: 'id', dataType: 'string', nullable: false, isPrimaryKey: true },
          { name: 'actionType', dataType: 'string', nullable: false },
        ],
        schemaVersion: '1',
      };
    },
    async *snapshot() {
      yield* fromIndex(0);
    },
    async *read(cursor: Cursor) {
      const start = cursor.token ? Number(cursor.token) : 0;
      const idx = Number.isFinite(start) ? start : 0;
      yield* fromIndex(idx);
    },
    async checkpoint() {
      return { token: String(events.length) };
    },
    async health() {
      return { state: 'ok' as const, checkedAt: clock() };
    },
    async *subscribe(cursor?: Cursor) {
      const start = cursor?.token ? Number(cursor.token) : 0;
      const idx = Number.isFinite(start) ? start : 0;
      yield* fromIndex(idx);
    },
  };

  return connector;
}
