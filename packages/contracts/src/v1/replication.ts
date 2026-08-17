/**
 * contracts — src/v1/replication.ts
 * Protocolo de replicação incremental / cross-ontology / cross-ACL (Passo 33).
 *
 * US 8,886,601 / US 9,785,694 — replicação incremental (plano + chunks + snapshot).
 * US 9,330,157 / US 10,061,828 — mapa de ontologia + digest + round-trip.
 * US 8,527,461 / US 8,782,004 / US 9,715,518 / US 10,089,345 — cross-ACL
 *   (filtro por unidade; mudança redigida ainda avança o checkpoint).
 * US 10,621,198 — filtragem por classificação.
 * US 8,838,538 — mudança de ACL é mutation.
 *
 * Gate: réplica sem permissão converge mesmo recebendo mudança redigida.
 */

import type { VersionVector } from './offline.js';

export type ReplicationOperation = 'create' | 'update' | 'delete' | 'acl';

export const REPLICATION_OPERATIONS: readonly ReplicationOperation[] = [
  'create',
  'update',
  'delete',
  'acl',
];

export interface ReplicationPolicy {
  acl: string;
  classification?: string;
}

export interface ReplicationMutation {
  mutationId: string;
  sourceReplica: string;
  logicalClock: number;
  objectId: string;
  unitId: string;
  objectType?: string;
  operation: ReplicationOperation;
  /** null quando redigido — o vetor e a policy permanecem. */
  payload: unknown;
  redacted: boolean;
  policy: ReplicationPolicy;
  timestamp: string;
  dependencies: string[];
  version: VersionVector;
}

export interface VectorCheckpoint {
  replicaId: string;
  peerId: string;
  vector: VersionVector;
  atLogicalClock: number;
}

export interface ReplicationChunkSpec {
  chunkId: number;
  objectIdMin: string;
  objectIdMax: string;
  complete: boolean;
}

export interface ReplicationPlan {
  planId: string;
  snapshotClock: number;
  peerId: string;
  chunks: ReplicationChunkSpec[];
}

export interface ReplicationChunk {
  planId: string;
  chunkId: number;
  snapshotClock: number;
  mutations: ReplicationMutation[];
}

export type OntologyTypeKind = 'object' | 'property' | 'link';

export interface OntologyMapSpec {
  systemIds: readonly [string, string];
  objectMappings: Record<string, string>;
  propertyMappings: Record<string, string>;
  linkMappings: Record<string, string>;
  objectParentChild: Record<string, string[]>;
  linkParentChild: Record<string, string[]>;
  linkReverse: string[];
  droppedTypes: Record<string, string[]>;
}

export function buildGoldenReplicationMutation(): ReplicationMutation {
  return {
    mutationId: 'mut-1',
    sourceReplica: 'A',
    logicalClock: 1,
    objectId: 'obj-1',
    unitId: 'title',
    objectType: 'Person',
    operation: 'create',
    payload: 'Ada Lovelace',
    redacted: false,
    policy: { acl: 'public', classification: 'Unclassified' },
    timestamp: '2024-06-01T12:00:00.000Z',
    dependencies: [],
    version: { A: 1 },
  };
}

export function buildGoldenOntologyMapSpec(): OntologyMapSpec {
  return {
    systemIds: ['site-a', 'site-b'],
    objectMappings: { Person: 'Employee' },
    propertyMappings: { title: 'displayName' },
    linkMappings: { ParentOf: 'ChildOf' },
    objectParentChild: { Agent: ['Person', 'Org'] },
    linkParentChild: {},
    linkReverse: ['ParentOf'],
    droppedTypes: { 'site-a': ['InternalNote'] },
  };
}

export function assertReplicationMutation(m: ReplicationMutation): void {
  if (!m.mutationId) throw new Error('ReplicationMutation: mutationId obrigatório');
  if (!m.sourceReplica) throw new Error('ReplicationMutation: sourceReplica obrigatório');
  if (!m.objectId) throw new Error('ReplicationMutation: objectId obrigatório');
  if (!m.unitId) throw new Error('ReplicationMutation: unitId obrigatório');
  if (!REPLICATION_OPERATIONS.includes(m.operation)) {
    throw new Error(`ReplicationMutation: operation inválida (${m.operation})`);
  }
  if (!m.policy?.acl) throw new Error('ReplicationMutation: policy.acl obrigatório');
  if (typeof m.logicalClock !== 'number' || m.logicalClock < 0) {
    throw new Error('ReplicationMutation: logicalClock inválido');
  }
  if (m.redacted && m.payload !== null) {
    throw new Error('ReplicationMutation: redacted implica payload null');
  }
}

export function isReplicationOperation(value: string): value is ReplicationOperation {
  return (REPLICATION_OPERATIONS as readonly string[]).includes(value);
}
