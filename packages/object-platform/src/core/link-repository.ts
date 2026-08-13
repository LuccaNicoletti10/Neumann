/**
 * object-platform — src/core/link-repository.ts
 * Generic in-memory LinkRepository with cardinality checks.
 *
 * WORLD NOW (default list): live links whose endpoints are still live.
 * WORLD HISTORY: includeDeletedEndpoints / includeDeletedLinks.
 */

import type {
  CreateLinkInput,
  LinkRecord,
  LinkRecordId,
  LinkRepository,
  LinkTypeId,
  ListLinksOptions,
  ObjectTypeId,
  OntologyId,
} from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import { LinkIntegrityError } from './errors.js';
import { cardinalityViolation, resolveCardinality } from './link-integrity.js';
import type { Clock, IdGenerator } from './types.js';

export interface CreateMemoryLinkRepositoryOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /**
   * Optional existence check — inject ObjectRepository.get for integrity.
   * When provided, create() rejects dangling endpoints and list*() hides
   * links whose endpoints are deleted (WORLD NOW).
   */
  objectExists?: (
    ontologyId: string,
    objectTypeId: string,
    primaryKey: string,
  ) => boolean | Promise<boolean>;
  /** Cardinality from LinkType schema (never trust raw client). */
  cardinalityOf?: (
    ontologyId: string,
    linkTypeId: string,
  ) => string | undefined | Promise<string | undefined>;
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

function freezeLink(link: LinkRecord): LinkRecord {
  return Object.freeze({
    ...link,
    provenance: link.provenance ? Object.freeze({ ...link.provenance }) : undefined,
  });
}

export function createMemoryLinkRepository(
  opts: CreateMemoryLinkRepositoryOptions = {},
): LinkRepository {
  const clock = opts.clock ?? createSystemClock();
  const nextId = opts.nextId ?? createUuidIdGenerator();

  const byId = new Map<LinkRecordId, LinkRecord>();
  const byKey = new Map<string, LinkRecordId>();

  function liveLinks(): LinkRecord[] {
    return [...byId.values()].filter((l) => !l.deleted);
  }

  function hasFromSource(input: CreateLinkInput): boolean {
    return liveLinks().some(
      (link) =>
        link.ontologyId === input.ontologyId &&
        link.linkTypeId === input.linkTypeId &&
        link.sourceObjectTypeId === input.sourceObjectTypeId &&
        link.sourcePrimaryKey === input.sourcePrimaryKey,
    );
  }

  function hasIntoTarget(input: CreateLinkInput): boolean {
    return liveLinks().some(
      (link) =>
        link.ontologyId === input.ontologyId &&
        link.linkTypeId === input.linkTypeId &&
        link.targetObjectTypeId === input.targetObjectTypeId &&
        link.targetPrimaryKey === input.targetPrimaryKey,
    );
  }

  async function endpointsLive(link: LinkRecord): Promise<boolean> {
    if (!opts.objectExists) return true;
    const srcOk = await opts.objectExists(
      link.ontologyId,
      link.sourceObjectTypeId,
      link.sourcePrimaryKey,
    );
    const tgtOk = await opts.objectExists(
      link.ontologyId,
      link.targetObjectTypeId,
      link.targetPrimaryKey,
    );
    return Boolean(srcOk && tgtOk);
  }

  async function visible(link: LinkRecord, listOpts?: ListLinksOptions): Promise<boolean> {
    if (link.deleted && !listOpts?.includeDeletedLinks) return false;
    if (!listOpts?.includeDeletedEndpoints && !(await endpointsLive(link))) return false;
    return true;
  }

  return {
    async create(input: CreateLinkInput): Promise<LinkRecord> {
      const key = linkKey(input);
      const existingId = byKey.get(key);
      const existing = existingId ? byId.get(existingId) : undefined;

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
        ? await opts.cardinalityOf(input.ontologyId, input.linkTypeId)
        : undefined;
      const cardinality = resolveCardinality(schemaCardinality, input.cardinality);

      if (existing && !existing.deleted) {
        throw new LinkIntegrityError(`link already exists: ${input.linkTypeId}`);
      }

      const violated = cardinalityViolation(cardinality, hasFromSource(input), hasIntoTarget(input));
      if (violated) throw new LinkIntegrityError(`${violated} (${input.linkTypeId})`);

      const now = clock();
      const record = freezeLink({
        id: existing?.id ?? nextId('link'),
        ontologyId: input.ontologyId,
        linkTypeId: input.linkTypeId,
        sourceObjectTypeId: input.sourceObjectTypeId,
        sourcePrimaryKey: input.sourcePrimaryKey,
        targetObjectTypeId: input.targetObjectTypeId,
        targetPrimaryKey: input.targetPrimaryKey,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        version: (existing?.version ?? 0) + 1,
        deleted: false,
        cardinality,
        source: input.source ?? existing?.source,
        provenance: input.provenance ?? existing?.provenance,
        principal: input.principal ?? existing?.principal,
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
      const prev = byId.get(id);
      if (!prev || prev.deleted) return false;
      byId.set(
        id,
        freezeLink({
          ...prev,
          deleted: true,
          version: (prev.version ?? 1) + 1,
          updatedAt: clock(),
        }),
      );
      return true;
    },

    async listFrom(
      ontologyId: OntologyId,
      sourceObjectTypeId: ObjectTypeId,
      sourcePrimaryKey: string,
      linkTypeId?: LinkTypeId,
      listOpts?: ListLinksOptions,
    ) {
      const out: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        if (link.sourceObjectTypeId !== sourceObjectTypeId) continue;
        if (link.sourcePrimaryKey !== sourcePrimaryKey) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        if (!(await visible(link, listOpts))) continue;
        out.push(link);
      }
      return out;
    },

    async listTo(
      ontologyId: OntologyId,
      targetObjectTypeId: ObjectTypeId,
      targetPrimaryKey: string,
      linkTypeId?: LinkTypeId,
      listOpts?: ListLinksOptions,
    ) {
      const out: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        if (link.targetObjectTypeId !== targetObjectTypeId) continue;
        if (link.targetPrimaryKey !== targetPrimaryKey) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        if (!(await visible(link, listOpts))) continue;
        out.push(link);
      }
      return out;
    },
  };
}
