/**
 * object-platform — src/core/link-repository.ts
 * Generic in-memory LinkRepository with cardinality checks.
 */

import type {
  CreateLinkInput,
  LinkRecord,
  LinkRecordId,
  LinkRepository,
  LinkTypeId,
  ObjectTypeId,
  OntologyId,
} from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import { LinkIntegrityError } from './errors.js';
import type { Clock, IdGenerator } from './types.js';

export interface CreateMemoryLinkRepositoryOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /**
   * Optional existence check — inject ObjectRepository.get for integrity.
   * When provided, create() rejects dangling endpoints.
   */
  objectExists?: (
    ontologyId: string,
    objectTypeId: string,
    primaryKey: string,
  ) => boolean | Promise<boolean>;
  /** Cardinality from LinkType schema (never trust raw client). */
  cardinalityOf?: (linkTypeId: string) => string | undefined | Promise<string | undefined>;
}

function linkKey(input: {
  ontologyId: string;
  linkTypeId: string;
  sourceObjectTypeId: string;
  sourcePrimaryKey: string;
  targetObjectTypeId: string;
  targetPrimaryKey: string;
}): string {
  return [
    input.ontologyId,
    input.linkTypeId,
    input.sourceObjectTypeId,
    input.sourcePrimaryKey,
    input.targetObjectTypeId,
    input.targetPrimaryKey,
  ].join('|');
}

export function createMemoryLinkRepository(
  opts: CreateMemoryLinkRepositoryOptions = {},
): LinkRepository {
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();

  const byId = new Map<LinkRecordId, LinkRecord>();
  const byKey = new Map<string, LinkRecordId>();

  function enforceCardinality(input: CreateLinkInput, cardinality?: string): void {
    const c = cardinality ?? input.cardinality;
    if (!c || c === 'N:N') return;

    // 1:1 — at most one edge from source and at most one into target
    // 1:N — many from source OK; at most one into a given target
    // N:1 — at most one from a given source; many into target OK
    if (c === '1:1' || c === 'N:1') {
      for (const link of byId.values()) {
        if (link.ontologyId !== input.ontologyId) continue;
        if (link.linkTypeId !== input.linkTypeId) continue;
        if (link.sourceObjectTypeId !== input.sourceObjectTypeId) continue;
        if (link.sourcePrimaryKey !== input.sourcePrimaryKey) continue;
        throw new LinkIntegrityError(`cardinality ${c} violated for ${input.linkTypeId}`);
      }
    }
    if (c === '1:1' || c === '1:N') {
      for (const link of byId.values()) {
        if (link.ontologyId !== input.ontologyId) continue;
        if (link.linkTypeId !== input.linkTypeId) continue;
        if (link.targetObjectTypeId !== input.targetObjectTypeId) continue;
        if (link.targetPrimaryKey !== input.targetPrimaryKey) continue;
        throw new LinkIntegrityError(`cardinality ${c} violated on target for ${input.linkTypeId}`);
      }
    }
  }

  return {
    async create(input: CreateLinkInput): Promise<LinkRecord> {
      const key = linkKey(input);
      if (byKey.has(key)) {
        throw new LinkIntegrityError(`link already exists: ${input.linkTypeId}`);
      }
      if (opts.objectExists) {
        const srcOk = await opts.objectExists(
          input.ontologyId,
          input.sourceObjectTypeId,
          input.sourcePrimaryKey,
        );
        const tgtOk = await opts.objectExists(
          input.ontologyId,
          input.targetObjectTypeId,
          input.targetPrimaryKey,
        );
        if (!srcOk || !tgtOk) {
          throw new LinkIntegrityError('link endpoints must reference existing objects');
        }
      }
      const schemaCardinality = opts.cardinalityOf
        ? await opts.cardinalityOf(input.linkTypeId)
        : undefined;
      const cardinality = (schemaCardinality ?? input.cardinality) as
        | CreateLinkInput['cardinality']
        | undefined;
      enforceCardinality(input, cardinality);
      const record: LinkRecord = Object.freeze({
        id: nextId('link'),
        ontologyId: input.ontologyId,
        linkTypeId: input.linkTypeId,
        sourceObjectTypeId: input.sourceObjectTypeId,
        sourcePrimaryKey: input.sourcePrimaryKey,
        targetObjectTypeId: input.targetObjectTypeId,
        targetPrimaryKey: input.targetPrimaryKey,
        createdAt: clock(),
        cardinality,
      });
      byId.set(record.id, record);
      byKey.set(key, record.id);
      return record;
    },

    delete(
      ontologyId,
      linkTypeId,
      sourceObjectTypeId,
      sourcePrimaryKey,
      targetObjectTypeId,
      targetPrimaryKey,
    ) {
      const key = linkKey({
        ontologyId,
        linkTypeId,
        sourceObjectTypeId,
        sourcePrimaryKey,
        targetObjectTypeId,
        targetPrimaryKey,
      });
      const id = byKey.get(key);
      if (!id) return false;
      byKey.delete(key);
      byId.delete(id);
      return true;
    },

    listFrom(
      ontologyId: OntologyId,
      sourceObjectTypeId: ObjectTypeId,
      sourcePrimaryKey: string,
      linkTypeId?: LinkTypeId,
    ) {
      const out: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        if (link.sourceObjectTypeId !== sourceObjectTypeId) continue;
        if (link.sourcePrimaryKey !== sourcePrimaryKey) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        out.push(link);
      }
      return out;
    },

    listTo(
      ontologyId: OntologyId,
      targetObjectTypeId: ObjectTypeId,
      targetPrimaryKey: string,
      linkTypeId?: LinkTypeId,
    ) {
      const out: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        if (link.targetObjectTypeId !== targetObjectTypeId) continue;
        if (link.targetPrimaryKey !== targetPrimaryKey) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        out.push(link);
      }
      return out;
    },
  };
}
