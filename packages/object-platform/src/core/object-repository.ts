/**
 * object-platform — src/core/object-repository.ts
 * Generic in-memory ObjectRepository (domain-neutral).
 *
 * Soft-delete semantic: recreating the same logical PK REVIVES the identity
 * (same id, version++, deleted=false) rather than inventing a new identity.
 */

import type {
  CreateObjectInput,
  DeleteObjectInput,
  ListObjectsOptions,
  ObjectRecord,
  ObjectRecordId,
  ObjectRepository,
  OntologyId,
  ObjectTypeId,
  UpdateObjectInput,
} from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import { DuplicateObjectError, ObjectNotFoundError, VersionConflictError } from './errors.js';
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

function sortRecords(out: ObjectRecord[], opts?: ListObjectsOptions): ObjectRecord[] {
  if (!opts?.orderBy) return out;
  const { property, direction } = opts.orderBy;
  const dir = direction === 'desc' ? -1 : 1;
  return [...out].sort((a, b) => {
    const av = a.properties[property];
    const bv = b.properties[property];
    if (av === bv) return 0;
    if (av == null) return -1 * dir;
    if (bv == null) return 1 * dir;
    return (av < bv ? -1 : 1) * dir;
  });
}

export function createMemoryObjectRepository(
  opts: CreateMemoryObjectRepositoryOptions = {},
): ObjectRepository {
  // Production-safe defaults; tests inject deterministic providers.
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();

  const byId = new Map<ObjectRecordId, ObjectRecord>();
  const byPk = new Map<string, ObjectRecordId>();

  function requireLive(
    ontologyId: OntologyId,
    objectTypeId: ObjectTypeId,
    primaryKey: string,
  ): ObjectRecord {
    const id = byPk.get(pkKey(ontologyId, objectTypeId, primaryKey));
    const obj = id ? byId.get(id) : undefined;
    if (!obj || obj.deleted) {
      throw new ObjectNotFoundError(`object not found: ${objectTypeId}/${primaryKey}`);
    }
    return obj;
  }

  return {
    create(input: CreateObjectInput): ObjectRecord {
      const key = pkKey(input.ontologyId, input.objectTypeId, input.primaryKey);
      const existingId = byPk.get(key);
      const existing = existingId ? byId.get(existingId) : undefined;

      if (existing && !existing.deleted) {
        throw new DuplicateObjectError(
          `object already exists: ${input.objectTypeId}/${input.primaryKey}`,
        );
      }

      const now = clock();
      // Soft-delete revive: keep identity, bump version.
      if (existing && existing.deleted) {
        const revived = freezeRecord({
          ...existing,
          ontologyVersionId: input.ontologyVersionId ?? existing.ontologyVersionId,
          properties: { ...(input.properties ?? {}) },
          version: existing.version + 1,
          deleted: false,
          updatedAt: now,
          source: input.source ?? existing.source,
          provenance: input.provenance ?? existing.provenance,
        });
        byId.set(revived.id, revived);
        return revived;
      }

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
      out = sortRecords(out, opts);
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit;
      if (limit != null) return out.slice(offset, offset + limit);
      return offset ? out.slice(offset) : out;
    },

    update(ontologyId, objectTypeId, primaryKey, input: UpdateObjectInput) {
      const prev = requireLive(ontologyId, objectTypeId, primaryKey);
      if (input.expectedVersion != null && prev.version !== input.expectedVersion) {
        throw new VersionConflictError(
          `version conflict: expected ${input.expectedVersion}, got ${prev.version}`,
          {
            expectedVersion: input.expectedVersion,
            actualVersion: prev.version,
            objectTypeId,
            primaryKey,
          },
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

    delete(ontologyId, objectTypeId, primaryKey, input?: DeleteObjectInput) {
      const key = pkKey(ontologyId, objectTypeId, primaryKey);
      const id = byPk.get(key);
      if (!id) {
        if (input?.expectedVersion != null) {
          throw new ObjectNotFoundError(`object not found: ${objectTypeId}/${primaryKey}`);
        }
        return false;
      }
      const prev = byId.get(id);
      if (!prev || prev.deleted) {
        if (input?.expectedVersion != null) {
          throw new ObjectNotFoundError(`object not found: ${objectTypeId}/${primaryKey}`);
        }
        return false;
      }
      if (input?.expectedVersion != null && prev.version !== input.expectedVersion) {
        throw new VersionConflictError(
          `version conflict: expected ${input.expectedVersion}, got ${prev.version}`,
          {
            expectedVersion: input.expectedVersion,
            actualVersion: prev.version,
            objectTypeId,
            primaryKey,
          },
        );
      }
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
