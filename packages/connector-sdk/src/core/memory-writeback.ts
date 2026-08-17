/**
 * connector-sdk — src/core/memory-writeback.ts
 * Fonte não-objeto em memória + writeBack (Passo 25).
 * Não é ERP real — simula a plataforma externa do sync.
 */

import type {
  CanonicalEvent,
  Connector,
  WriteBackRequest,
  WriteBackResult,
} from 'contracts';

import { createEventFactory } from './event-factory.js';
import { createFixedClock, createIdGenerator } from './determinism.js';

export interface MemoryWriteBackConnector extends Connector {
  records: Map<string, Record<string, unknown>>;
  getRecord(primaryKey: string): Record<string, unknown> | undefined;
}

export function createMemoryWriteBackConnector(opts: {
  connectorId?: string;
  sourceSystem?: string;
  objectName?: string;
  records?: Record<string, Record<string, unknown>>;
  /** Inherited onto every CanonicalEvent (Passo 26). */
  defaultPolicyTags?: string[];
}): MemoryWriteBackConnector {
  const connectorId = opts.connectorId ?? 'memory-src';
  const sourceSystem = opts.sourceSystem ?? 'ext';
  const objectName = opts.objectName ?? 'orders';
  const defaultPolicyTags = opts.defaultPolicyTags ?? [];
  const records = new Map<string, Record<string, unknown>>(
    Object.entries(opts.records ?? {}).map(([k, v]) => [k, { ...v }]),
  );
  const seenKeys = new Map<string, WriteBackResult>();
  const factory = createEventFactory({
    clock: createFixedClock('2024-01-01T00:00:00.000Z'),
    nextId: createIdGenerator(),
  });
  let seq = 0;

  function toEvent(pk: string, fields: Record<string, unknown>): CanonicalEvent {
    seq += 1;
    return factory.create({
      source_system: sourceSystem,
      source_object: objectName,
      source_primary_key: pk,
      schema_version: '1',
      connector_id: connectorId,
      checkpoint: String(seq),
      principal: 'sa:writeback',
      policy_tags: defaultPolicyTags,
      payload: { ...fields, id: pk },
    });
  }

  const connector: MemoryWriteBackConnector = {
    connectorId,
    capabilities: ['snapshot', 'cdc', 'writeback'],
    records,
    getRecord(primaryKey) {
      const row = records.get(primaryKey);
      return row ? { ...row } : undefined;
    },
    async discover() {
      return [{ name: objectName, sourceSystem }];
    },
    async schema(obj) {
      return {
        object: obj,
        columns: [
          { name: 'id', dataType: 'string', nullable: false, isPrimaryKey: true },
        ],
        schemaVersion: '1',
      };
    },
    async *snapshot() {
      for (const [pk, fields] of records) {
        yield toEvent(pk, fields);
      }
    },
    async *read(cursor) {
      const start = cursor.token ? Number(cursor.token) : 0;
      let i = 0;
      for (const [pk, fields] of records) {
        i += 1;
        if (i > start) yield toEvent(pk, fields);
      }
    },
    async checkpoint() {
      return { token: String(records.size) };
    },
    async health() {
      return { state: 'ok', checkedAt: '2024-01-01T00:00:00.000Z' };
    },
    async writeBack(req: WriteBackRequest): Promise<WriteBackResult> {
      const cached = seenKeys.get(req.idempotencyKey);
      if (cached) return { ...cached, record: cached.record ? { ...cached.record } : undefined };
      const current = records.get(req.primaryKey) ?? {};
      const next = { ...current, ...req.fields };
      records.set(req.primaryKey, next);
      const result: WriteBackResult = { ok: true, record: { ...next } };
      seenKeys.set(req.idempotencyKey, result);
      return { ok: true, record: { ...next } };
    },
  };
  return connector;
}
