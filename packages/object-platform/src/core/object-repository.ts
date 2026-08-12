/**
 * object-platform — src/core/object-repository.ts
 * Generic in-memory ObjectRepository (domain-neutral).
 */

import type {
  CreateObjectInput,
  ListObjectsOptions,
  ObjectRecord,
  ObjectRecordId,
  ObjectRepository,
  OntologyId,
  ObjectTypeId,
  UpdateObjectInput,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import type { Clock, IdGenerator } from './types.js';

export interface CreateMemoryObjectRepositoryOptions {
  clock?: Clock;
  nextId?: IdGenerator;
}

function pkKey(ontologyId: string, objectTypeId: string, primaryKey: string): string {
  return `${ontologyId}::${objectTypeId}::${primaryKey}`;
}

function freezeRecord(o: ObjectRecord): ObjectRecord {
  return Object.freeze({
    ...o,
    properties: Object.freeze({ ...o.properties }),
    provenance: o.provenance ? Object.freeze({ ...o.provenance }) : undefined,
  });
}

export function createMemoryObjectRepository(
  opts: CreateMemoryObjectRepositoryOptions = {},
): ObjectRepository {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();

  const byId = new Map<ObjectRecordId, ObjectRecord>();
  const byPk = new Map<string, ObjectRecordId>();

  function requireByPk(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
  ): ObjectRecord {
    const id = byPk.get(pkKey(ontologyId, objectTypeId, primaryKey));
    const obj = id ? byId.get(id) : undefined;
    if (!obj || obj.deleted) {
      throw new Error(`object not found: ${objectTypeId}/${primaryKey}`);
    }
    return obj;
  }

  return {
    create(input: CreateObjectInput): ObjectRecord {
      const key = pkKey(input.ontologyId, input.objectTypeId, input.primaryKey);
      const existingId = byPk.get(key);
      if (existingId) {
        const existing = byId.get(existingId);
        if (existing && !existing.deleted) {
          throw new Error(`object already exists: ${input.objectTypeId}/${input.primaryKey}`);
        }
      }
      const now = clock();
      const record = freezeRecord({
        id: nextId('obj'),
        ontologyId: input.ontologyId,
        ontologyVersionId: input.ontologyVersionId,
        objectTypeId: input.objectTypeId,
        primaryKey: input.primaryKey,
        properties: { ...(input.properties ?? {}) },
        version: 1,
        deleted: false,
        createdAt: now,
        updatedAt: now,
        source: input.source,
        provenance: input.provenance,
      });
      byId.set(record.id, record);
      byPk.set(key, record.id);
      return record;
    },

    get(ontologyId, objectTypeId, primaryKey) {
      const id = byPk.get(pkKey(ontologyId, objectTypeId, primaryKey));
      if (!id) return undefined;
      const obj = byId.get(id);
      if (!obj || obj.deleted) return undefined;
      return obj;
    },

    getById(id) {
      const obj = byId.get(id);
      if (!obj || obj.deleted) return undefined;
      return obj;
    },

    list(ontologyId, objectTypeId, opts?: ListObjectsOptions) {
      let out: ObjectRecord[] = [];
      for (const obj of byId.values()) {
        if (obj.ontologyId !== ontologyId) continue;
        if (obj.objectTypeId !== objectTypeId) continue;
        if (!opts?.includeDeleted && obj.deleted) continue;
        out.push(obj);
      }
      if (opts?.orderBy) {
        const { property, direction } = opts.orderBy;
        const dir = direction === 'desc' ? -1 : 1;
        out = [...out].sort((a, b) => {
          const av = a.properties[property];
          const bv = b.properties[property];
          if (av === bv) return 0;
          if (av == null) return -1 * dir;
          if (bv == null) return 1 * dir;
          return (av < bv ? -1 : 1) * dir;
        });
      }
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit;
      if (limit != null) return out.slice(offset, offset + limit);
      return offset ? out.slice(offset) : out;
    },

    update(ontologyId, objectTypeId, primaryKey, input: UpdateObjectInput) {
      const prev = requireByPk(ontologyId, objectTypeId, primaryKey);
      if (input.expectedVersion != null && prev.version !== input.expectedVersion) {
        throw new Error(
          `version conflict: expected ${input.expectedVersion}, got ${prev.version}`,
        );
      }
      const properties =
        input.mode === 'replace'
          ? { ...input.properties }
          : { ...prev.properties, ...input.properties };
      const next = freezeRecord({
        ...prev,
        properties,
        version: prev.version + 1,
        updatedAt: clock(),
      });
      byId.set(next.id, next);
      return next;
    },

    delete(ontologyId, objectTypeId, primaryKey) {
      const key = pkKey(ontologyId, objectTypeId, primaryKey);
      const id = byPk.get(key);
      if (!id) return false;
      const prev = byId.get(id);
      if (!prev || prev.deleted) return false;
      byId.set(
        id,
        freezeRecord({
          ...prev,
          deleted: true,
          version: prev.version + 1,
          updatedAt: clock(),
        }),
      );
      return true;
    },
  };
}
