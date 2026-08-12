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

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import type { Clock, IdGenerator } from './types.js';

export interface CreateMemoryLinkRepositoryOptions {
  clock?: Clock;
  nextId?: IdGenerator;
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
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();

  const byId = new Map<LinkRecordId, LinkRecord>();
  const byKey = new Map<string, LinkRecordId>();

  function enforceCardinality(input: CreateLinkInput): void {
    const c = input.cardinality;
    if (!c) return;

    if (c === '1:1' || c === '1:N') {
      for (const link of byId.values()) {
        if (link.ontologyId !== input.ontologyId) continue;
        if (link.linkTypeId !== input.linkTypeId) continue;
        if (link.sourceObjectTypeId !== input.sourceObjectTypeId) continue;
        if (link.sourcePrimaryKey !== input.sourcePrimaryKey) continue;
        if (c === '1:1') {
          throw new Error(`cardinality 1:1 violated for ${input.linkTypeId}`);
        }
      }
    }
    if (c === '1:1' || c === 'N:1') {
      for (const link of byId.values()) {
        if (link.ontologyId !== input.ontologyId) continue;
        if (link.linkTypeId !== input.linkTypeId) continue;
        if (link.targetObjectTypeId !== input.targetObjectTypeId) continue;
        if (link.targetPrimaryKey !== input.targetPrimaryKey) continue;
        throw new Error(`cardinality ${c} violated on target for ${input.linkTypeId}`);
      }
    }
  }

  return {
    create(input: CreateLinkInput): LinkRecord {
      const key = linkKey(input);
      if (byKey.has(key)) {
        throw new Error(`link already exists: ${input.linkTypeId}`);
      }
      enforceCardinality(input);
      const record: LinkRecord = Object.freeze({
        id: nextId('link'),
        ontologyId: input.ontologyId,
        linkTypeId: input.linkTypeId,
        sourceObjectTypeId: input.sourceObjectTypeId,
        sourcePrimaryKey: input.sourcePrimaryKey,
        targetObjectTypeId: input.targetObjectTypeId,
        targetPrimaryKey: input.targetPrimaryKey,
        createdAt: clock(),
        cardinality: input.cardinality,
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
