/**
 * object-platform — src/core/link-repository.ts
 * Generic in-memory LinkRepository with cardinality checks.
 *
 * WORLD NOW (default list): live links whose endpoints are still live.
 * WORLD HISTORY: includeDeletedEndpoints / includeDeletedLinks.
 */

import type {
  CreateLinkInput,
  DeleteLinkInput,
  LinkRecord,
  LinkRecordId,
  LinkRepository,
  LinkTypeId,
  ListLinksOptions,
  ObjectTypeId,
  OntologyId,
} from 'contracts';

import { VersionConflictError } from './errors.js';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import { LinkIntegrityError } from './errors.js';
import { cardinalityViolation, resolveCardinality } from './link-integrity.js';
import type { MemoryCheckpoint } from './memory-checkpoint.js';
import { restoreMap } from './memory-checkpoint.js';
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
  ) => Promise<boolean>;
  /** Cardinality from LinkType schema (never trust raw client). */
  cardinalityOf?: (
    ontologyId: string,
    linkTypeId: string,
  ) => Promise<string | undefined>;
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
): LinkRepository & MemoryCheckpoint {
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
    const [srcOk, tgtOk] = await Promise.all([
      opts.objectExists(link.ontologyId, link.sourceObjectTypeId, link.sourcePrimaryKey),
      opts.objectExists(link.ontologyId, link.targetObjectTypeId, link.targetPrimaryKey),
    ]);
    return srcOk && tgtOk;
  }

  async function visible(link: LinkRecord, listOpts?: ListLinksOptions): Promise<boolean> {
    if (link.deleted && !listOpts?.includeDeletedLinks) return false;
    if (listOpts?.includeDeletedEndpoints) return true;
    return endpointsLive(link);
  }

  async function filterVisible(
    candidates: LinkRecord[],
    listOpts?: ListLinksOptions,
  ): Promise<LinkRecord[]> {
    const flags = await Promise.all(candidates.map((link) => visible(link, listOpts)));
    return candidates.filter((_, i) => flags[i] === true);
  }

  function insertLink(input: CreateLinkInput, schemaCardinality: string | undefined): LinkRecord {
    const key = linkKey(input);
    const existingId = byKey.get(key);
    const existing = existingId ? byId.get(existingId) : undefined;
    const cardinality = resolveCardinality(schemaCardinality, input.cardinality);

    // WHY: CAS guard — when the caller declares expectedVersion we must compare
    // atomically before writing. This prevents a concurrent projection from
    // reviving a link that was deleted by another action.
    if (input.expectedVersion !== undefined) {
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw new VersionConflictError(
          `link version conflict: expected ${input.expectedVersion}, got ${currentVersion}`,
        );
      }
    }

    if (existing && !existing.deleted) {
      // WHY: active upsert is CAS on version — distinct from revive (deleted=true).
      // expectedVersion is required; without it this is a pure-create conflict.
      if (input.expectedVersion === undefined) {
        throw new LinkIntegrityError(`link already exists: ${input.linkTypeId}`);
      }
      const now = clock();
      const record = freezeLink({
        ...existing,
        updatedAt: now,
        version: (existing.version ?? 0) + 1,
        cardinality: cardinality ?? existing.cardinality,
        source: input.source ?? existing.source,
        provenance: input.provenance ?? existing.provenance,
        principal: input.principal ?? existing.principal,
      });
      byId.set(record.id, record);
      return record;
    }
    const violated = cardinalityViolation(cardinality, hasFromSource(input), hasIntoTarget(input));
    if (violated) throw new LinkIntegrityError(`${violated} (${input.linkTypeId})`);
    const now = clock();
    const record = freezeLink({
      id: input.id ?? existing?.id ?? nextId('link'),
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
  }

  return {
    async create(input: CreateLinkInput): Promise<LinkRecord> {
      const [srcOk, tgtOk, schemaCardinality] = await Promise.all([
        opts.objectExists
          ? opts.objectExists(input.ontologyId, input.sourceObjectTypeId, input.sourcePrimaryKey)
          : true,
        opts.objectExists
          ? opts.objectExists(input.ontologyId, input.targetObjectTypeId, input.targetPrimaryKey)
          : true,
        opts.cardinalityOf
          ? opts.cardinalityOf(input.ontologyId, input.linkTypeId)
          : undefined,
      ]);
      if (opts.objectExists && (!srcOk || !tgtOk)) {
        throw new LinkIntegrityError('link endpoints must reference existing objects');
      }
      return insertLink(input, schemaCardinality);
    },

    async delete(
      ontologyId,
      linkTypeId,
      sourceObjectTypeId,
      sourcePrimaryKey,
      targetObjectTypeId,
      targetPrimaryKey,
      input?: DeleteLinkInput,
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
      // WHY: CAS — if the caller provides expectedVersion we must compare atomically
      // before writing. Zero rows = VERSION_CONFLICT (not a silent no-op).
      if (input?.expectedVersion !== undefined && prev.version !== input.expectedVersion) {
        throw new VersionConflictError(
          `link version conflict: expected ${input.expectedVersion}, got ${prev.version ?? 'undefined'}`,
        );
      }
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
    ): Promise<LinkRecord[]> {
      const candidates: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        if (link.sourceObjectTypeId !== sourceObjectTypeId) continue;
        if (link.sourcePrimaryKey !== sourcePrimaryKey) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        candidates.push(link);
      }
      return filterVisible(candidates, listOpts);
    },

    async listTo(
      ontologyId: OntologyId,
      targetObjectTypeId: ObjectTypeId,
      targetPrimaryKey: string,
      linkTypeId?: LinkTypeId,
      listOpts?: ListLinksOptions,
    ): Promise<LinkRecord[]> {
      const candidates: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        if (link.targetObjectTypeId !== targetObjectTypeId) continue;
        if (link.targetPrimaryKey !== targetPrimaryKey) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        candidates.push(link);
      }
      return filterVisible(candidates, listOpts);
    },

    async listAll(ontologyId: OntologyId, listOpts?: ListLinksOptions): Promise<LinkRecord[]> {
      const candidates: LinkRecord[] = [];
      for (const link of byId.values()) {
        if (link.ontologyId !== ontologyId) continue;
        candidates.push(link);
      }
      return filterVisible(candidates, listOpts);
    },

    capture() {
      return { byId: new Map(byId), byKey: new Map(byKey) };
    },

    restore(snapshot: unknown) {
      const snap = snapshot as { byId: Map<LinkRecordId, LinkRecord>; byKey: Map<string, LinkRecordId> };
      restoreMap(byId, snap.byId);
      restoreMap(byKey, snap.byKey);
    },
  };
}
