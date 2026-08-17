/**
 * federation — src/core/memory-source.ts
 * Fonte in-memory que NÃO pode ser copiada pelo caminho federado (T1.5).
 * snapshot() existe no contrato mas o planner nunca o chama.
 */

import type {
  CanonicalEvent,
  Connector,
  FederatedQueryResult,
  FederatedRow,
  FederatedRowAcl,
  ObjectRef,
  PushdownSpec,
} from 'contracts';

import { applyPushdown, isPushedDown } from './pushdown.js';

export interface MemoryFederatedRecord {
  objectId: string;
  fields: Record<string, unknown>;
  lastUpdated: string;
  acl: FederatedRowAcl;
}

export interface MemoryFederatedConnector extends Connector {
  records: Map<string, MemoryFederatedRecord>;
  lastPushdown?: PushdownSpec;
  snapshotCallCount: number;
  federatedQueryCallCount: number;
  federatedQuerySync(spec: PushdownSpec): FederatedQueryResult;
  upsertRecord(rec: MemoryFederatedRecord): void;
}

export function createMemoryFederatedConnector(opts: {
  connectorId: string;
  sourceSystem: string;
  objectName: string;
  records?: MemoryFederatedRecord[];
}): MemoryFederatedConnector {
  const records = new Map<string, MemoryFederatedRecord>();
  for (const rec of opts.records ?? []) {
    records.set(rec.objectId, {
      ...rec,
      fields: { ...rec.fields },
      acl: {
        ...rec.acl,
        entries: rec.acl.entries.map((e) => ({ ...e })),
        propertyEntries: rec.acl.propertyEntries
          ? Object.fromEntries(
              Object.entries(rec.acl.propertyEntries).map(([k, v]) => [
                k,
                v.map((e) => ({ ...e })),
              ]),
            )
          : undefined,
      },
    });
  }

  const connector: MemoryFederatedConnector = {
    connectorId: opts.connectorId,
    capabilities: ['pushdown'],
    records,
    snapshotCallCount: 0,
    federatedQueryCallCount: 0,

    upsertRecord(rec) {
      records.set(rec.objectId, {
        ...rec,
        fields: { ...rec.fields },
        acl: { ...rec.acl, entries: rec.acl.entries.map((e) => ({ ...e })) },
      });
    },

    federatedQuerySync(spec: PushdownSpec): FederatedQueryResult {
      connector.federatedQueryCallCount += 1;
      connector.lastPushdown = spec;
      const rows: FederatedRow[] = [];
      for (const rec of records.values()) {
        rows.push({
          fragmentId: `${opts.connectorId}:${rec.objectId}`,
          objectId: rec.objectId,
          fields: { ...rec.fields },
          lastUpdated: rec.lastUpdated,
          acl: {
            ...rec.acl,
            sourceSystemId: opts.sourceSystem,
            entries: rec.acl.entries.map((e) => ({ ...e })),
            propertyEntries: rec.acl.propertyEntries,
          },
        });
      }
      const filtered = applyPushdown(rows, spec);
      return {
        object: spec.object,
        rows: filtered,
        copied: false,
        pushedDown: isPushedDown(spec),
      };
    },

    async federatedQuery(spec) {
      return connector.federatedQuerySync(spec);
    },

    async discover() {
      return [{ name: opts.objectName, sourceSystem: opts.sourceSystem }];
    },
    async schema(obj: ObjectRef) {
      return {
        object: obj,
        columns: [{ name: 'id', dataType: 'string', nullable: false, isPrimaryKey: true }],
        schemaVersion: '1',
      };
    },
    async *snapshot(): AsyncIterable<CanonicalEvent> {
      connector.snapshotCallCount += 1;
    },
    async *read() {},
    async checkpoint() {
      return { token: '' };
    },
    async health() {
      return { state: 'ok', checkedAt: '2024-06-01T12:00:00.000Z' };
    },
  };

  return connector;
}
