/**
 * replication — src/core/site.ts
 * Site multimaster: unidades ACL, mutation, redaction, checkpoint.
 */

import { assertReplicationMutation, type ReplicationMutation, type VectorCheckpoint, type VersionVector } from 'contracts';
import { resolveClassification, type ClassificationLevel } from 'contracts';

import type { Clock, IdGenerator } from './determinism.js';
import { createDeterministicClock, createIdGenerator, createLogicalClock } from './determinism.js';
import { compareVectors, incrementVector, isOrderedBefore, mergeVectors } from './vector.js';

export interface AccessUnit {
  id: string;
  value: unknown;
  acl: string;
  classification: string;
  version: VersionVector;
  redacted: boolean;
  deleted: boolean;
}

export interface ReplicatedObject {
  id: string;
  objectType: string;
  units: Record<string, AccessUnit>;
}

export type ApplyStatus = 'applied' | 'discarded' | 'conflict';

export interface ApplyResult {
  status: ApplyStatus;
  mutationId: string;
}

export interface PeerPolicy {
  /** ACLs que o peer PODE ver. Outras saem redigidas. */
  allowedAcls: readonly string[];
  /** Rank máximo de classificação visível (inclusive). */
  maxClassificationRank?: number;
}

export interface ReplicationSite {
  readonly id: string;
  mutate(input: {
    objectId: string;
    unitId: string;
    objectType?: string;
    operation?: ReplicationMutation['operation'];
    payload: unknown;
    acl: string;
    classification?: string;
    dependencies?: string[];
  }): ReplicationMutation;
  apply(mutation: ReplicationMutation): ApplyResult;
  exportForPeer(peerId: string, policy: PeerPolicy): ReplicationMutation[];
  checkpoint(peerId: string): VectorCheckpoint;
  getObject(objectId: string): ReplicatedObject | undefined;
  objects(): ReplicatedObject[];
  logicalClock(): number;
  visibleValue(objectId: string, unitId: string): unknown;
}

function cloneUnit(u: AccessUnit): AccessUnit {
  return { ...u, version: { ...u.version } };
}

function cloneObject(o: ReplicatedObject): ReplicatedObject {
  const units: Record<string, AccessUnit> = {};
  for (const [k, v] of Object.entries(o.units)) units[k] = cloneUnit(v);
  return { id: o.id, objectType: o.objectType, units };
}

function unitVisible(unit: AccessUnit, policy: PeerPolicy): boolean {
  if (!policy.allowedAcls.includes(unit.acl)) return false;
  if (policy.maxClassificationRank === undefined) return true;
  const level: ClassificationLevel = resolveClassification(unit.classification);
  return level.rank <= policy.maxClassificationRank;
}

function mergeCheckpoint(existing: VersionVector, incoming: VersionVector): VersionVector {
  return mergeVectors(existing, incoming);
}

export function createReplicationSite(opts: {
  id: string;
  nextId?: IdGenerator;
  clock?: Clock;
}): ReplicationSite {
  const nextId = opts.nextId ?? createIdGenerator();
  const clock = opts.clock ?? createDeterministicClock();
  const logical = createLogicalClock();
  const objects = new Map<string, ReplicatedObject>();
  const applied = new Set<string>();
  const log: ReplicationMutation[] = [];
  const checkpoints = new Map<string, VersionVector>();

  function record(mutation: ReplicationMutation): void {
    applied.add(mutation.mutationId);
    log.push(mutation);
  }

  function applyIncoming(mutation: ReplicationMutation): ApplyResult {
    assertReplicationMutation(mutation);
    if (applied.has(mutation.mutationId)) {
      return { status: 'discarded', mutationId: mutation.mutationId };
    }

    let obj = objects.get(mutation.objectId);
    if (!obj) {
      obj = { id: mutation.objectId, objectType: mutation.objectType ?? 'Object', units: {} };
      objects.set(mutation.objectId, obj);
    }
    if (mutation.objectType) obj.objectType = mutation.objectType;

    const local = obj.units[mutation.unitId];
    if (!local) {
      obj.units[mutation.unitId] = {
        id: mutation.unitId,
        value: mutation.redacted ? null : mutation.payload,
        acl: mutation.policy.acl,
        classification: mutation.policy.classification ?? 'Unclassified',
        version: { ...mutation.version },
        redacted: mutation.redacted,
        deleted: mutation.operation === 'delete',
      };
      record(mutation);
      return { status: 'applied', mutationId: mutation.mutationId };
    }

    const cmp = compareVectors(local.version, mutation.version);
    if (cmp === 'identical') {
      applied.add(mutation.mutationId);
      return { status: 'discarded', mutationId: mutation.mutationId };
    }
    if (cmp === 'ordered' && !isOrderedBefore(local.version, mutation.version)) {
      applied.add(mutation.mutationId);
      return { status: 'discarded', mutationId: mutation.mutationId };
    }
    if (cmp === 'ordered' || cmp === 'concurrent') {
      if (cmp === 'concurrent') {
        // tie-break: maior logicalClock vence; empate → sourceReplica lexicográfico
        const localClk = log.filter((m) => m.objectId === mutation.objectId && m.unitId === mutation.unitId).at(-1)
          ?.logicalClock ?? 0;
        if (mutation.logicalClock < localClk) {
          local.version = mergeVectors(local.version, mutation.version);
          applied.add(mutation.mutationId);
          return { status: 'conflict', mutationId: mutation.mutationId };
        }
        if (mutation.logicalClock === localClk && mutation.sourceReplica < opts.id) {
          local.version = mergeVectors(local.version, mutation.version);
          applied.add(mutation.mutationId);
          return { status: 'conflict', mutationId: mutation.mutationId };
        }
      }
      local.version = mergeVectors(local.version, mutation.version);
      if (mutation.operation === 'acl') {
        local.acl = mutation.policy.acl;
        if (!mutation.redacted && mutation.payload !== null) {
          local.value = mutation.payload;
          local.redacted = false;
        }
      } else if (mutation.operation === 'delete') {
        local.deleted = true;
        local.value = null;
      } else if (!mutation.redacted) {
        local.value = mutation.payload;
        local.redacted = false;
        local.acl = mutation.policy.acl;
        local.classification = mutation.policy.classification ?? local.classification;
        local.deleted = false;
      } else {
        local.redacted = true;
        local.value = null;
        local.acl = mutation.policy.acl;
      }
      record(mutation);
      return { status: cmp === 'concurrent' ? 'conflict' : 'applied', mutationId: mutation.mutationId };
    }
    applied.add(mutation.mutationId);
    return { status: 'discarded', mutationId: mutation.mutationId };
  }

  const site: ReplicationSite = {
    id: opts.id,

    mutate(input) {
      const existing = objects.get(input.objectId);
      const unit = existing?.units[input.unitId];
      const version = incrementVector(unit?.version ?? {}, opts.id);
      const mutation: ReplicationMutation = {
        mutationId: nextId('mut'),
        sourceReplica: opts.id,
        logicalClock: logical.tick(),
        objectId: input.objectId,
        unitId: input.unitId,
        objectType: input.objectType ?? existing?.objectType,
        operation: input.operation ?? (unit ? 'update' : 'create'),
        payload: input.payload,
        redacted: false,
        policy: {
          acl: input.acl,
          classification: input.classification ?? 'Unclassified',
        },
        timestamp: clock(),
        dependencies: input.dependencies ?? [],
        version,
      };
      applyIncoming(mutation);
      return mutation;
    },

    apply(mutation) {
      return applyIncoming(mutation);
    },

    exportForPeer(peerId, policy) {
      const latest = new Map<string, ReplicationMutation>();
      for (const mutation of log) {
        latest.set(`${mutation.objectId}:${mutation.unitId}`, mutation);
      }
      const out: ReplicationMutation[] = [];
      for (const mutation of latest.values()) {
        const obj = objects.get(mutation.objectId);
        const unit = obj?.units[mutation.unitId];
        if (!unit) continue;
        if (unitVisible(unit, policy)) {
          out.push({
            ...mutation,
            operation: unit.deleted ? 'delete' : mutation.operation === 'acl' ? 'acl' : 'update',
            payload: unit.deleted ? null : unit.value,
            redacted: false,
            policy: { acl: unit.acl, classification: unit.classification },
            version: { ...unit.version },
          });
          continue;
        }
        out.push({
          ...mutation,
          payload: null,
          redacted: true,
          policy: { acl: unit.acl, classification: unit.classification },
          version: { ...unit.version },
        });
      }
      const ck = checkpoints.get(peerId) ?? {};
      let merged = ck;
      for (const m of out) merged = mergeCheckpoint(merged, m.version);
      checkpoints.set(peerId, merged);
      return out;
    },

    checkpoint(peerId) {
      return {
        replicaId: opts.id,
        peerId,
        vector: { ...(checkpoints.get(peerId) ?? {}) },
        atLogicalClock: logical.current(),
      };
    },

    getObject(objectId) {
      const obj = objects.get(objectId);
      return obj ? cloneObject(obj) : undefined;
    },

    objects() {
      return [...objects.values()].map(cloneObject);
    },

    logicalClock() {
      return logical.current();
    },

    visibleValue(objectId, unitId) {
      const unit = objects.get(objectId)?.units[unitId];
      if (!unit || unit.redacted || unit.deleted) return undefined;
      return unit.value;
    },
  };

  return site;
}

export function replicate(from: ReplicationSite, to: ReplicationSite, policy: PeerPolicy): ApplyResult[] {
  const mutations = from.exportForPeer(to.id, policy);
  return mutations.map((m) => to.apply(m));
}
