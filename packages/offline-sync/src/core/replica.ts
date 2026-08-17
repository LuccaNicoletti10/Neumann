/**
 * offline-sync — src/core/replica.ts
 * US 8,515,912 — site multimaster: apply / discard / conflict / resolve.
 */

import {
  canonicalAuthorizedState,
  objectVisibleTo,
  type AmbiguousDataConflict,
  type ApplyStatus,
  type ConflictResolution,
  type PrincipalId,
  type ReplicaId,
  type ReplicaLink,
  type ReplicaLinkSet,
  type ReplicaObject,
  type ReplicaUpdate,
  type VersionVector,
} from 'contracts';

import {
  applyObjectResolution,
  cloneLinkSet,
  cloneObject,
  detectLinkSetConflict,
  detectObjectConflicts,
  mergeLinkSets,
} from './conflict.js';
import type { Clock, IdGenerator } from './determinism.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { compareVectors, incrementVector, isOrderedBefore, mergeVectors, samePayload } from './version-vector.js';

export interface ApplyResult {
  status: ApplyStatus;
  updateId: string;
  conflicts: AmbiguousDataConflict[];
}

export interface UpsertObjectInput {
  id?: string;
  objectType: string;
  title: string;
  properties?: Record<string, unknown>;
  photo?: string;
  deleted?: boolean;
  resolvedWith?: string[];
  aclPrincipals: PrincipalId[];
}

export interface Replica {
  readonly id: ReplicaId;
  getObject(id: string): ReplicaObject | undefined;
  getLinkSet(id: string): ReplicaLinkSet | undefined;
  objects(): ReplicaObject[];
  linkSets(): ReplicaLinkSet[];
  log(): ReplicaUpdate[];
  hasApplied(updateId: string): boolean;
  upsertObject(input: UpsertObjectInput): ReplicaUpdate;
  patchObject(
    id: string,
    patch: {
      objectType?: string;
      title?: string;
      properties?: Record<string, unknown>;
      photo?: string;
      deleted?: boolean;
      resolvedWith?: string[];
      aclPrincipals?: PrincipalId[];
    },
  ): ReplicaUpdate;
  addLink(objectA: string, objectB: string, linkType: string, symmetric?: boolean): ReplicaUpdate;
  apply(update: ReplicaUpdate): ApplyResult;
  pendingConflicts(): AmbiguousDataConflict[];
  resolve(conflictId: string, resolution: ConflictResolution): ReplicaUpdate;
  resolveAll(conflictIds: string[], resolution: ConflictResolution): number;
  authorizedObjects(principal: PrincipalId): ReplicaObject[];
  authorizedState(principal: PrincipalId): string;
  cloneAuthorized(opts: { replicaId: ReplicaId; principal: PrincipalId }): Replica;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function objectFingerprint(obj: ReplicaObject): unknown {
  return {
    objectType: obj.objectType,
    title: obj.title,
    properties: obj.properties,
    photo: obj.photo ?? null,
    deleted: obj.deleted ?? false,
    resolvedWith: [...obj.resolvedWith].sort(),
  };
}

export function createReplica(opts: {
  id: ReplicaId;
  nextId?: IdGenerator;
  clock?: Clock;
}): Replica {
  const nextId = opts.nextId ?? createIdGenerator();
  const clock = opts.clock ?? createDeterministicClock();
  const objects = new Map<string, ReplicaObject>();
  const linkSets = new Map<string, ReplicaLinkSet>();
  const pairToLinkSet = new Map<string, string>();
  const applied = new Set<string>();
  const updates: ReplicaUpdate[] = [];
  const conflicts: AmbiguousDataConflict[] = [];

  function record(update: ReplicaUpdate): void {
    applied.add(update.id);
    updates.push(update);
  }

  function clearConflictsFor(objectId?: string, linkSetId?: string): void {
    for (const c of conflicts) {
      if (objectId && c.objectId === objectId) c.resolved = true;
      if (linkSetId && c.linkSetId === linkSetId) c.resolved = true;
    }
  }

  function emitObjectUpdate(obj: ReplicaObject): ReplicaUpdate {
    const update: ReplicaUpdate = {
      id: nextId('upd'),
      replicaId: opts.id,
      kind: 'object',
      objectId: obj.id,
      version: { ...obj.version },
      object: cloneObject(obj),
    };
    record(update);
    return update;
  }

  function emitLinkUpdate(ls: ReplicaLinkSet): ReplicaUpdate {
    const update: ReplicaUpdate = {
      id: nextId('upd'),
      replicaId: opts.id,
      kind: 'linkSet',
      linkSetId: ls.id,
      version: { ...ls.version },
      linkSet: cloneLinkSet(ls),
    };
    record(update);
    return update;
  }

  function applyObjectUpdate(update: ReplicaUpdate): ApplyResult {
    const incoming = update.object;
    if (!incoming || !update.objectId) {
      return { status: 'discarded', updateId: update.id, conflicts: [] };
    }
    const local = objects.get(update.objectId);
    if (!local) {
      objects.set(update.objectId, cloneObject(incoming));
      record(update);
      return { status: 'applied', updateId: update.id, conflicts: [] };
    }
    const localVV = local.version;
    const incomingVV = update.version;
    const cmp = compareVectors(localVV, incomingVV);
    if (cmp === 'identical') {
      applied.add(update.id);
      return { status: 'discarded', updateId: update.id, conflicts: [] };
    }
    if (cmp === 'ordered') {
      if (isOrderedBefore(localVV, incomingVV)) {
        const next = cloneObject(incoming);
        next.version = mergeVectors(localVV, incomingVV);
        objects.set(update.objectId, next);
        clearConflictsFor(update.objectId);
        record(update);
        return { status: 'applied', updateId: update.id, conflicts: [] };
      }
      applied.add(update.id);
      return { status: 'discarded', updateId: update.id, conflicts: [] };
    }
    if (samePayload(objectFingerprint(local), objectFingerprint(incoming))) {
      local.version = mergeVectors(localVV, incomingVV);
      clearConflictsFor(update.objectId);
      record(update);
      return { status: 'applied', updateId: update.id, conflicts: [] };
    }
    const found = detectObjectConflicts(local, incoming, {
      nextId,
      now: clock(),
      localDeploymentName: opts.id,
      peerDeploymentName: update.replicaId,
      localVersion: localVV,
      incomingVersion: incomingVV,
    });
    conflicts.push(...found);
    applied.add(update.id);
    return { status: 'conflict', updateId: update.id, conflicts: found };
  }

  function applyLinkUpdate(update: ReplicaUpdate): ApplyResult {
    const incoming = update.linkSet;
    if (!incoming || !update.linkSetId) {
      return { status: 'discarded', updateId: update.id, conflicts: [] };
    }
    let local = linkSets.get(update.linkSetId);
    if (!local) {
      const byPair = pairToLinkSet.get(pairKey(incoming.objectA, incoming.objectB));
      local = byPair ? linkSets.get(byPair) : undefined;
    }
    if (!local) {
      linkSets.set(update.linkSetId, cloneLinkSet(incoming));
      pairToLinkSet.set(pairKey(incoming.objectA, incoming.objectB), incoming.id);
      record(update);
      return { status: 'applied', updateId: update.id, conflicts: [] };
    }
    const cmp = compareVectors(local.version, update.version);
    if (cmp === 'identical') {
      applied.add(update.id);
      return { status: 'discarded', updateId: update.id, conflicts: [] };
    }
    if (cmp === 'ordered') {
      if (isOrderedBefore(local.version, update.version)) {
        const next = cloneLinkSet(incoming);
        next.id = local.id;
        next.version = mergeVectors(local.version, update.version);
        linkSets.set(local.id, next);
        pairToLinkSet.set(pairKey(next.objectA, next.objectB), next.id);
        clearConflictsFor(undefined, local.id);
        record(update);
        return { status: 'applied', updateId: update.id, conflicts: [] };
      }
      applied.add(update.id);
      return { status: 'discarded', updateId: update.id, conflicts: [] };
    }
    const found = detectLinkSetConflict(local, incoming, {
      nextId,
      now: clock(),
      localDeploymentName: opts.id,
      peerDeploymentName: update.replicaId,
      localVersion: local.version,
      incomingVersion: update.version,
    });
    conflicts.push(found);
    applied.add(update.id);
    return { status: 'conflict', updateId: update.id, conflicts: [found] };
  }

  const replica: Replica = {
    id: opts.id,

    getObject(id) {
      const obj = objects.get(id);
      return obj ? cloneObject(obj) : undefined;
    },

    getLinkSet(id) {
      const ls = linkSets.get(id);
      return ls ? cloneLinkSet(ls) : undefined;
    },

    objects() {
      return [...objects.values()].map(cloneObject);
    },

    linkSets() {
      return [...linkSets.values()].map(cloneLinkSet);
    },

    log() {
      return updates.map((u) => ({
        ...u,
        version: { ...u.version },
        object: u.object ? cloneObject(u.object) : undefined,
        linkSet: u.linkSet ? cloneLinkSet(u.linkSet) : undefined,
      }));
    },

    hasApplied(updateId) {
      return applied.has(updateId);
    },

    upsertObject(input) {
      const id = input.id ?? nextId('obj');
      const existing = objects.get(id);
      const version: VersionVector = incrementVector(existing?.version ?? {}, opts.id);
      const obj: ReplicaObject = {
        id,
        objectType: input.objectType,
        title: input.title,
        properties: { ...(input.properties ?? existing?.properties ?? {}) },
        photo: input.photo ?? existing?.photo,
        deleted: input.deleted ?? existing?.deleted,
        resolvedWith: [...(input.resolvedWith ?? existing?.resolvedWith ?? [])],
        aclPrincipals: [...input.aclPrincipals],
        version,
      };
      objects.set(id, obj);
      clearConflictsFor(id);
      return emitObjectUpdate(obj);
    },

    patchObject(id, patch) {
      const existing = objects.get(id);
      if (!existing) throw new Error(`object ${id} not found`);
      return replica.upsertObject({
        id,
        objectType: patch.objectType ?? existing.objectType,
        title: patch.title ?? existing.title,
        properties: patch.properties ? { ...existing.properties, ...patch.properties } : { ...existing.properties },
        photo: patch.photo ?? existing.photo,
        deleted: patch.deleted ?? existing.deleted,
        resolvedWith: patch.resolvedWith ?? existing.resolvedWith,
        aclPrincipals: patch.aclPrincipals ?? existing.aclPrincipals,
      });
    },

    addLink(objectA, objectB, linkType, symmetric = false) {
      const key = pairKey(objectA, objectB);
      const existingId = pairToLinkSet.get(key);
      let ls = existingId ? linkSets.get(existingId) : undefined;
      if (!ls) {
        const id = nextId('ls');
        ls = { id, objectA, objectB, links: [], version: {} };
        linkSets.set(id, ls);
        pairToLinkSet.set(key, id);
      }
      const link: ReplicaLink = {
        id: nextId('link'),
        source: objectA,
        target: objectB,
        linkType,
        symmetric,
      };
      ls.links.push(link);
      ls.version = incrementVector(ls.version, opts.id);
      return emitLinkUpdate(ls);
    },

    apply(update) {
      if (applied.has(update.id)) {
        return { status: 'discarded', updateId: update.id, conflicts: [] };
      }
      if (update.kind === 'linkSet') return applyLinkUpdate(update);
      return applyObjectUpdate(update);
    },

    pendingConflicts() {
      return conflicts.filter((c) => !c.resolved).map((c) => ({ ...c }));
    },

    resolve(conflictId, resolution) {
      const conflict = conflicts.find((c) => c.id === conflictId && !c.resolved);
      if (!conflict) throw new Error(`conflict ${conflictId} not found`);

      if (conflict.objectId) {
        const local = objects.get(conflict.objectId);
        const peer = conflict.peerObject;
        if (!local || !peer) throw new Error(`conflict ${conflictId} missing objects`);
        const mergedVV = mergeVectors(local.version, conflict.incomingVersion);
        const next = applyObjectResolution(local, peer, resolution);
        next.version = mergedVV;
        objects.set(conflict.objectId, next);
        conflict.resolved = true;
        for (const c of conflicts) {
          if (c.objectId === conflict.objectId) c.resolved = true;
        }
        return emitObjectUpdate(next);
      }

      if (conflict.linkSetId) {
        const local = linkSets.get(conflict.linkSetId);
        const peer = conflict.peerLinkSet;
        if (!local || !peer) throw new Error(`conflict ${conflictId} missing link set`);
        const mergedVV = mergeVectors(local.version, conflict.incomingVersion);
        let next: ReplicaLinkSet;
        if (resolution.action === 'acceptPeer') next = cloneLinkSet(peer);
        else if (resolution.action === 'merge') next = mergeLinkSets(local, peer);
        else next = cloneLinkSet(local);
        next.version = mergedVV;
        linkSets.set(conflict.linkSetId, next);
        conflict.resolved = true;
        return emitLinkUpdate(next);
      }

      throw new Error(`conflict ${conflictId} has no target`);
    },

    resolveAll(conflictIds, resolution) {
      const uniqueObjects = new Set<string>();
      const uniqueLinks = new Set<string>();
      let count = 0;
      for (const id of conflictIds) {
        const c = conflicts.find((x) => x.id === id && !x.resolved);
        if (!c) continue;
        if (c.objectId) {
          if (uniqueObjects.has(c.objectId)) {
            c.resolved = true;
            count += 1;
            continue;
          }
          uniqueObjects.add(c.objectId);
        }
        if (c.linkSetId) {
          if (uniqueLinks.has(c.linkSetId)) {
            c.resolved = true;
            count += 1;
            continue;
          }
          uniqueLinks.add(c.linkSetId);
        }
        replica.resolve(id, resolution);
        count += 1;
      }
      return count;
    },

    authorizedObjects(principal) {
      return [...objects.values()].filter((o) => objectVisibleTo(o, principal)).map(cloneObject);
    },

    authorizedState(principal) {
      return canonicalAuthorizedState([...objects.values()], principal);
    },

    cloneAuthorized({ replicaId, principal }) {
      const child = createReplica({ id: replicaId, nextId, clock });
      for (const obj of objects.values()) {
        if (!objectVisibleTo(obj, principal)) continue;
        child.apply({
          id: nextId('snap'),
          replicaId: opts.id,
          kind: 'object',
          objectId: obj.id,
          version: { ...obj.version },
          object: cloneObject(obj),
        });
      }
      for (const ls of linkSets.values()) {
        const a = objects.get(ls.objectA);
        const b = objects.get(ls.objectB);
        if (!a || !b) continue;
        if (!objectVisibleTo(a, principal) || !objectVisibleTo(b, principal)) continue;
        child.apply({
          id: nextId('snap'),
          replicaId: opts.id,
          kind: 'linkSet',
          linkSetId: ls.id,
          version: { ...ls.version },
          linkSet: cloneLinkSet(ls),
        });
      }
      return child;
    },
  };

  return replica;
}
