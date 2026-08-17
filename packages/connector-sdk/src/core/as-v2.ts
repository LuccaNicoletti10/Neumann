/**
 * connector-sdk — adapt v1 Connector to v2 protocol (feature flag path).
 */
import type { Connector } from 'contracts';

import type { ConnectorProtocolMessage, ConnectorV2 } from './protocol.js';
import { emptyState, mergeState } from './protocol.js';

export function asConnectorV2(connector: Connector, version = '1.0.0'): ConnectorV2 {
  return {
    async spec() {
      return {
        connectorId: connector.connectorId,
        version,
        configSchema: { type: 'object' },
      };
    },
    async check() {
      const h = await connector.health();
      return { ok: h.state === 'ok', message: h.message };
    },
    async discover() {
      return connector.discover();
    },
    async schema(stream) {
      const objects = await connector.discover();
      const obj = objects.find((o) => o.name === stream) ?? objects[0];
      if (!obj) throw new Error('no streams');
      return connector.schema({ sourceSystem: obj.sourceSystem, objectName: obj.name });
    },
    async *read(opts) {
      const objects = await connector.discover();
      const obj = objects[0];
      if (!obj) {
        yield { type: 'ERROR', message: 'no streams' } satisfies ConnectorProtocolMessage;
        return;
      }
      const ref = { sourceSystem: obj.sourceSystem, objectName: obj.name };
      let state = opts.state ?? emptyState();
      const iter = opts.fullRefresh
        ? connector.snapshot(ref)
        : connector.read(state.streams[obj.name] ?? { token: '' });
      for await (const record of iter) {
        yield { type: 'RECORD', record } satisfies ConnectorProtocolMessage;
        state = mergeState(state, obj.name, { token: record.checkpoint });
      }
      yield { type: 'STATE', state } satisfies ConnectorProtocolMessage;
    },
    writeBack: connector.writeBack
      ? (req) => connector.writeBack!(req)
      : undefined,
    federatedQuery: connector.federatedQuery
      ? (spec) => connector.federatedQuery!(spec)
      : undefined,
    subscribe: connector.subscribe
      ? async function* subscribe(opts?: { state?: { streams: Record<string, { token: string }> } }) {
          const objects = await connector.discover();
          const obj = objects[0];
          if (!obj) {
            yield { type: 'ERROR', message: 'no streams' } satisfies ConnectorProtocolMessage;
            return;
          }
          const cursor = opts?.state?.streams[obj.name] ?? { token: '' };
          let state = opts?.state ?? emptyState();
          for await (const record of connector.subscribe!(cursor)) {
            yield { type: 'RECORD', record } satisfies ConnectorProtocolMessage;
            state = mergeState(state, obj.name, { token: record.checkpoint });
          }
          yield { type: 'STATE', state } satisfies ConnectorProtocolMessage;
        }
      : undefined,
  };
}
