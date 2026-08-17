/**
 * connector-sdk — v2 protocol messages (SPEC/CHECK/DISCOVER/READ).
 * Airbyte-inspired behavior, original TypeScript implementation.
 */
import type {
  CanonicalEvent,
  Cursor,
  FederatedQueryResult,
  PushdownSpec,
  SourceObject,
  SourceSchema,
  WriteBackRequest,
  WriteBackResult,
} from 'contracts';

export type ConnectorProtocolMessage =
  | { type: 'SPEC'; spec: ConnectorSpec }
  | { type: 'CHECK'; ok: boolean; message?: string }
  | { type: 'DISCOVER'; streams: SourceObject[] }
  | { type: 'RECORD'; record: CanonicalEvent }
  | { type: 'STATE'; state: ConnectorState }
  | { type: 'ERROR'; message: string };

export interface ConnectorSpec {
  connectorId: string;
  version: string;
  documentationUrl?: string;
  configSchema: Record<string, unknown>;
}

export interface ConnectorState {
  streams: Record<string, Cursor>;
}

export interface ConnectorV2 {
  spec(): Promise<ConnectorSpec>;
  check(): Promise<{ ok: boolean; message?: string }>;
  discover(): Promise<SourceObject[]>;
  schema(stream: string): Promise<SourceSchema>;
  read(opts: { fullRefresh?: boolean; state?: ConnectorState }): AsyncIterable<ConnectorProtocolMessage>;
  writeBack?(req: WriteBackRequest): Promise<WriteBackResult>;
  federatedQuery?(spec: PushdownSpec): Promise<FederatedQueryResult>;
  subscribe?(opts?: { state?: ConnectorState }): AsyncIterable<ConnectorProtocolMessage>;
}

export interface ConnectorYaml {
  name: string;
  version: string;
  allowedHosts?: string[];
  quality?: 'certified' | 'community' | 'experimental';
}

export function parseConnectorYaml(text: string): ConnectorYaml {
  const name = /name:\s*(.+)/.exec(text)?.[1]?.trim();
  const version = /version:\s*(.+)/.exec(text)?.[1]?.trim();
  if (!name || !version) throw new Error('connector.yaml requires name and version');
  const quality = /quality:\s*(certified|community|experimental)/.exec(text)?.[1] as
    | ConnectorYaml['quality']
    | undefined;
  const hosts = [...text.matchAll(/allowedHosts:\s*\n((?:\s+-\s+.+\n?)+)/g)];
  const allowedHosts = hosts[0]
    ? hosts[0][1]!
        .split('\n')
        .map((l) => l.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean)
    : undefined;
  return { name, version, allowedHosts, quality };
}

export function emptyState(): ConnectorState {
  return { streams: {} };
}

export function mergeState(prev: ConnectorState, stream: string, cursor: Cursor): ConnectorState {
  return { streams: { ...prev.streams, [stream]: cursor } };
}
