/**
 * ingestion-runtime — EnvelopeSource. Connectors stay behind this port.
 */

import {
  envelopeFromCanonical,
  type ConnectorPage,
  type ConnectorRegistration,
  type RawEnvelope,
} from 'contracts';
import type { ConnectorV2 } from 'connector-sdk';

export interface EnvelopeSource {
  readonly connectorId: string;
  pullPage(cursor?: string): Promise<ConnectorPage>;
}

export interface ConnectorRegistry {
  resolve(connectorId: string): Promise<EnvelopeSource | undefined>;
}

export function createConnectorRegistry(
  sources: readonly EnvelopeSource[],
): ConnectorRegistry {
  const byId = new Map(sources.map((s) => [s.connectorId, s]));
  return { resolve: async (id) => byId.get(id) };
}

function afterCursor(envelopes: readonly RawEnvelope[], cursor?: string): RawEnvelope[] {
  if (!cursor) return [...envelopes];
  const idx = envelopes.findIndex((e) => e.metadata.checkpoint === cursor);
  return idx >= 0 ? envelopes.slice(idx + 1) : [...envelopes];
}

export function sourceFromEnvelopes(
  connectorId: string,
  envelopes: readonly RawEnvelope[],
): EnvelopeSource {
  return {
    connectorId,
    async pullPage(cursor) {
      const rest = afterCursor(envelopes, cursor);
      const last = rest[rest.length - 1]?.metadata.checkpoint;
      return { envelopes: rest, nextCursor: last, completed: true };
    },
  };
}

/**
 * Adapter over ConnectorV2.read. Checkpoint skip lives here so connectors stay dumb.
 * WHY not a live cursor inside the connector: checkpoint belongs to IngestionRuntime.
 */
export function sourceFromConnectorV2(connector: ConnectorV2, connectorId: string): EnvelopeSource {
  return {
    connectorId,
    async pullPage(cursor) {
      const envelopes: RawEnvelope[] = [];
      let nextCursor = cursor;
      let error: string | undefined;
      for await (const msg of connector.read({ fullRefresh: !cursor })) {
        if (msg.type === 'RECORD') {
          const env = envelopeFromCanonical(msg.record);
          envelopes.push(env);
          if (msg.record.checkpoint) nextCursor = msg.record.checkpoint;
        } else if (msg.type === 'STATE') {
          const tokens = Object.values(msg.state.streams);
          const last = tokens[tokens.length - 1];
          if (last?.token) nextCursor = last.token;
        } else if (msg.type === 'ERROR') {
          error = msg.message;
        }
      }
      if (error) throw new Error(error);
      const rest = afterCursor(envelopes, cursor);
      const last = rest[rest.length - 1]?.metadata.checkpoint ?? nextCursor;
      return { envelopes: rest, nextCursor: last, completed: true };
    },
  };
}

export type SourceFactory = (
  registration: ConnectorRegistration,
) => EnvelopeSource | Promise<EnvelopeSource>;

export function createDurableConnectorRegistry(opts: {
  local?: readonly EnvelopeSource[];
  resolveRegistration?: (connectorId: string) => Promise<ConnectorRegistration | undefined>;
  sourceFactory?: SourceFactory;
}): ConnectorRegistry {
  const local = new Map((opts.local ?? []).map((s) => [s.connectorId, s]));
  return {
    async resolve(id) {
      const hit = local.get(id);
      if (hit) return hit;
      if (!opts.resolveRegistration || !opts.sourceFactory) return undefined;
      const reg = await opts.resolveRegistration(id);
      if (!reg || !reg.enabled) return undefined;
      if (reg.kind === 'webhook') return undefined;
      return opts.sourceFactory(reg);
    },
  };
}
