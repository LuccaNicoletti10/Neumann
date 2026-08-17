/**
 * offline-sync — src/core/investigation.ts
 * US 8,364,642 / US 8,812,444 / US 9,275,069 — .base / .dsco + logical clock.
 */

import type {
  BaseFile,
  ChangeRecord,
  ChangeSet,
  DiscoFile,
  Investigation,
  PrincipalId,
  ReplicaObject,
  ReplicaUpdate,
} from 'contracts';
import { objectVisibleTo } from 'contracts';

import { cloneObject } from './conflict.js';
import type { IdGenerator } from './determinism.js';
import { createIdGenerator } from './determinism.js';
import type { ApplyResult, Replica } from './replica.js';
import { createReplica } from './replica.js';

export interface LogicalClock {
  tick(): number;
  get(): number;
}

export function createLogicalClock(start = 0): LogicalClock {
  let value = start;
  return {
    tick() {
      value += 1;
      return value;
    },
    get() {
      return value;
    },
  };
}

function recordsFromObject(obj: ReplicaObject, clock: LogicalClock, operation: ChangeRecord['operation']): ChangeRecord[] {
  const records: ChangeRecord[] = [
    {
      obj_comp_id: `type_${obj.id}`,
      obj_id: obj.id,
      logical_clk: clock.tick(),
      deleted: false,
      value: obj.objectType,
      operation,
    },
    {
      obj_comp_id: `title_${obj.id}`,
      obj_id: obj.id,
      logical_clk: clock.tick(),
      deleted: false,
      value: obj.title,
      operation,
    },
  ];
  for (const [key, val] of Object.entries(obj.properties)) {
    records.push({
      obj_comp_id: `${key}_${obj.id}`,
      obj_id: obj.id,
      logical_clk: clock.tick(),
      deleted: obj.deleted === true,
      value: obj.deleted ? null : val,
      operation: obj.deleted ? 'delete' : operation,
    });
  }
  return records;
}

export interface BaseInstallation {
  replica: Replica;
  clock: LogicalClock;
  createInvestigation(input: {
    name: string;
    description?: string;
    principal: PrincipalId;
    objectIds: string[];
  }): Investigation;
  generateBaseFile(investigationId: string, objectIds?: string[], randomIdCount?: number): BaseFile;
  processDiscoFile(disco: DiscoFile, autoPublish?: boolean): { records: ChangeRecord[]; results: ApplyResult[] };
  getInvestigation(id: string): Investigation | undefined;
}

export function createBaseInstallation(opts: {
  replica: Replica;
  nextId?: IdGenerator;
  clock?: LogicalClock;
}): BaseInstallation {
  const nextId = opts.nextId ?? createIdGenerator();
  const clock = opts.clock ?? createLogicalClock();
  const investigations = new Map<string, Investigation>();
  const lastAckClock = new Map<string, number>();
  const previouslyIncluded = new Map<string, Set<string>>();
  const lastSnapshot = new Map<string, Map<string, ReplicaObject>>();

  function visibleObjects(principal: PrincipalId, ids: string[]): ReplicaObject[] {
    return ids
      .map((id) => opts.replica.getObject(id))
      .filter((o): o is ReplicaObject => o !== undefined && objectVisibleTo(o, principal));
  }

  return {
    replica: opts.replica,
    clock,

    createInvestigation(input) {
      const id = nextId('inv');
      const objects = visibleObjects(input.principal, input.objectIds);
      const records: ChangeRecord[] = [];
      for (const obj of objects) records.push(...recordsFromObject(obj, clock, 'create'));
      const cs: ChangeSet = {
        id: nextId('cs'),
        logicalClockValue: clock.get(),
        records,
        objectIds: objects.map((o) => o.id),
      };
      const inv: Investigation = {
        id,
        name: input.name,
        description: input.description,
        principal: input.principal,
        changeSets: [cs],
      };
      investigations.set(id, inv);
      previouslyIncluded.set(id, new Set(cs.objectIds));
      lastSnapshot.set(id, new Map(objects.map((o) => [o.id, cloneObject(o)])));
      return inv;
    },

    generateBaseFile(investigationId, objectIds, randomIdCount = 0) {
      const inv = investigations.get(investigationId);
      if (!inv) throw new Error(`investigation ${investigationId} not found`);
      const included = previouslyIncluded.get(investigationId) ?? new Set<string>();
      const snapshot = lastSnapshot.get(investigationId) ?? new Map<string, ReplicaObject>();
      const requested = objectIds ?? [...included];
      const objects = visibleObjects(inv.principal, requested);
      const targetIds = objects.map((o) => o.id);
      const newIds = targetIds.filter((id) => !included.has(id));

      const records: ChangeRecord[] = [];
      for (const obj of objects) {
        const prev = snapshot.get(obj.id);
        if (!prev || newIds.includes(obj.id)) {
          records.push(...recordsFromObject(obj, clock, 'create'));
          continue;
        }
        if (prev.objectType !== obj.objectType) {
          records.push({
            obj_comp_id: `type_${obj.id}`,
            obj_id: obj.id,
            logical_clk: clock.tick(),
            deleted: false,
            value: obj.objectType,
            operation: 'edit',
          });
        }
        if (prev.title !== obj.title) {
          records.push({
            obj_comp_id: `title_${obj.id}`,
            obj_id: obj.id,
            logical_clk: clock.tick(),
            deleted: false,
            value: obj.title,
            operation: 'edit',
          });
        }
        const keys = new Set([...Object.keys(prev.properties), ...Object.keys(obj.properties)]);
        for (const key of keys) {
          if (prev.properties[key] === obj.properties[key]) continue;
          records.push({
            obj_comp_id: `${key}_${obj.id}`,
            obj_id: obj.id,
            logical_clk: clock.tick(),
            deleted: obj.deleted === true && obj.properties[key] === undefined,
            value: obj.properties[key] ?? null,
            operation: obj.deleted ? 'delete' : 'edit',
          });
        }
      }

      const cs: ChangeSet = {
        id: nextId('cs'),
        logicalClockValue: clock.get(),
        records,
        objectIds: targetIds,
      };
      inv.changeSets.push(cs);
      for (const oid of newIds) included.add(oid);
      previouslyIncluded.set(investigationId, included);
      lastSnapshot.set(investigationId, new Map(objects.map((o) => [o.id, cloneObject(o)])));

      const linkSets = opts.replica.linkSets().filter((ls) => {
        return targetIds.includes(ls.objectA) && targetIds.includes(ls.objectB);
      });

      return {
        investigationId,
        principal: inv.principal,
        changeSets: [...inv.changeSets],
        objects: objects.map(cloneObject),
        linkSets,
        lastChangeSetId: cs.id,
        randomIdCount,
      };
    },

    processDiscoFile(disco, autoPublish = false) {
      const inv = investigations.get(disco.investigationId);
      if (!inv) throw new Error(`investigation ${disco.investigationId} not found`);
      if (disco.lastAcknowledgedChangeSetId) {
        inv.lastAcknowledgedChangeSetId = disco.lastAcknowledgedChangeSetId;
        const ackCs = inv.changeSets.find((c) => c.id === disco.lastAcknowledgedChangeSetId);
        if (ackCs) lastAckClock.set(disco.investigationId, ackCs.logicalClockValue);
      }
      const records = disco.changeSets.flatMap((cs) => cs.records);
      const results: ApplyResult[] = [];
      if (autoPublish) {
        for (const update of disco.replicaUpdates) {
          results.push(opts.replica.apply(update));
        }
      }
      return { records, results };
    },

    getInvestigation(id) {
      return investigations.get(id);
    },
  };
}

export interface DisconnectedInstallation {
  replica: Replica;
  loadBaseFile(base: BaseFile): void;
  localChange(
    objectId: string,
    patch: {
      objectType?: string;
      title?: string;
      properties?: Record<string, unknown>;
      deleted?: boolean;
    },
  ): ReplicaUpdate;
  generateDiscoFile(investigationId: string): DiscoFile;
  lastLoadedChangeSetId(): string | undefined;
}

export function createDisconnectedInstallation(opts: {
  replica?: Replica;
  nextId?: IdGenerator;
}): DisconnectedInstallation {
  const nextId = opts.nextId ?? createIdGenerator();
  const replica = opts.replica ?? createReplica({ id: 'disconnected', nextId });
  const loadedCs = new Set<string>();
  let lastLoaded: string | undefined;
  let investigationId: string | undefined;
  const localUpdates: ReplicaUpdate[] = [];

  return {
    replica,

    loadBaseFile(base) {
      investigationId = base.investigationId;
      for (const obj of base.objects) {
        replica.apply({
          id: nextId('base'),
          replicaId: 'base',
          kind: 'object',
          objectId: obj.id,
          version: { ...obj.version },
          object: cloneObject(obj),
        });
      }
      for (const ls of base.linkSets) {
        replica.apply({
          id: nextId('base'),
          replicaId: 'base',
          kind: 'linkSet',
          linkSetId: ls.id,
          version: { ...ls.version },
          linkSet: ls,
        });
      }
      for (const cs of base.changeSets) {
        if (!loadedCs.has(cs.id)) loadedCs.add(cs.id);
      }
      lastLoaded = base.lastChangeSetId;
    },

    localChange(objectId, patch) {
      const update = replica.patchObject(objectId, patch);
      localUpdates.push(update);
      return update;
    },

    generateDiscoFile(invId) {
      const id = invId || investigationId;
      if (!id) throw new Error('investigation not loaded');
      const records: ChangeRecord[] = [];
      const clock = createLogicalClock();
      for (const obj of replica.objects()) {
        records.push(...recordsFromObject(obj, clock, 'edit'));
      }
      const cs: ChangeSet = {
        id: nextId('cs'),
        logicalClockValue: clock.get(),
        records,
        objectIds: replica.objects().map((o) => o.id),
      };
      return {
        investigationId: id,
        changeSets: [cs],
        lastAcknowledgedChangeSetId: lastLoaded ?? '',
        replicaUpdates: localUpdates.map((u) => ({ ...u, object: u.object ? cloneObject(u.object) : undefined })),
        randomIdsConsumed: 0,
      };
    },

    lastLoadedChangeSetId() {
      return lastLoaded;
    },
  };
}
