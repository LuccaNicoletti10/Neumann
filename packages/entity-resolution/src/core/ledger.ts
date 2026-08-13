/**
 * entity-resolution — src/core/ledger.ts
 * Passo 21 persistence: match audit + canonical merge/unmerge + fingerprints.
 */

import {
  assertCanonicalEntity,
  assertMatchAuditEntry,
  type CanonicalEntity,
  type CanonicalEntityId,
  type EntityRecord,
  type FingerprintMatch,
  type MatchAuditEntry,
  type MatchAuditId,
  type MergeCanonicalInput,
  type MergeEvent,
  type RecordReviewInput,
  type ResolutionResult,
  type ResolutionRunId,
  type SourceCanonicalLink,
  type UnmergeInput,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import {
  blacklistHashes,
  fingerprintRecord,
  lookupFingerprintHits,
  type IndexedFingerprint,
} from './fingerprint.js';
import type { Clock, EntityLedger, IdGenerator } from './types.js';

export interface CreateMemoryEntityLedgerOptions {
  clock?: Clock;
  nextId?: IdGenerator;
}

function cloneCanonical(c: CanonicalEntity): CanonicalEntity {
  return { ...c, memberIds: [...c.memberIds] };
}

export function createMemoryEntityLedger(
  opts: CreateMemoryEntityLedgerOptions = {},
): EntityLedger {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();

  const audits = new Map<MatchAuditId, MatchAuditEntry>();
  const canonicals = new Map<CanonicalEntityId, CanonicalEntity>();
  const links: SourceCanonicalLink[] = [];
  const events: MergeEvent[] = [];
  const fingerprints: IndexedFingerprint[] = [];
  const banned = blacklistHashes();

  return {
    async commitRun(result: ResolutionResult): Promise<ResolutionRunId> {
      for (const c of result.candidates) {
        const entry: MatchAuditEntry = {
          id: nextId('audit') as MatchAuditId,
          runId: result.runId,
          leftId: c.leftId,
          rightId: c.rightId,
          objectTypeId: c.objectTypeId,
          blockKey: c.blockKey,
          score: c.score,
          confidence: c.confidence,
          features: { ...c.features, propertyScores: { ...c.features.propertyScores } },
          modelVersion: c.ruleVersionId,
          decision: c.decision,
          reason: c.reason,
          createdAt: clock(),
        };
        assertMatchAuditEntry(entry);
        audits.set(entry.id, entry);
      }
      return result.runId;
    },

    async listMatchAudit(filter) {
      let rows = [...audits.values()];
      if (filter?.runId) rows = rows.filter((r) => r.runId === filter.runId);
      if (filter?.decision) rows = rows.filter((r) => r.decision === filter.decision);
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return rows.map((r) => ({ ...r, features: { ...r.features, propertyScores: { ...r.features.propertyScores } }, review: r.review ? { ...r.review } : undefined }));
    },

    async getMatchAudit(id) {
      const row = audits.get(id);
      return row ? { ...row, features: { ...row.features, propertyScores: { ...row.features.propertyScores } }, review: row.review ? { ...row.review } : undefined } : undefined;
    },

    async recordReview(input: RecordReviewInput) {
      const row = audits.get(input.auditId);
      if (!row) throw new Error(`MatchAuditEntry não encontrado: ${input.auditId}`);
      const updated: MatchAuditEntry = {
        ...row,
        review: {
          decision: input.decision,
          reviewer: input.reviewer,
          at: clock(),
          note: input.note,
        },
      };
      audits.set(updated.id, updated);
      return { ...updated, review: { ...updated.review! } };
    },

    async mergeCanonical(input: MergeCanonicalInput) {
      const memberIds = [...new Set(input.memberIds)].sort();
      if (memberIds.length < 2) {
        throw new Error('mergeCanonical: precisa de pelo menos 2 memberIds');
      }
      const now = clock();
      let entity: CanonicalEntity;
      if (input.canonicalId) {
        const existing = canonicals.get(input.canonicalId);
        if (!existing) throw new Error(`CanonicalEntity não encontrado: ${input.canonicalId}`);
        if (existing.objectTypeId !== input.objectTypeId) {
          throw new Error('mergeCanonical: objectTypeId incompatível');
        }
        const merged = [...new Set([...existing.memberIds, ...memberIds])].sort();
        entity = {
          ...existing,
          memberIds: merged,
          displayName: input.displayName ?? existing.displayName,
          version: existing.version + 1,
          updatedAt: now,
        };
      } else {
        entity = {
          id: nextId('canon') as CanonicalEntityId,
          objectTypeId: input.objectTypeId,
          memberIds,
          displayName: input.displayName,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
      }
      assertCanonicalEntity(entity);
      canonicals.set(entity.id, entity);

      for (const recordId of memberIds) {
        const active = links.find(
          (l) => l.recordId === recordId && l.status === 'active' && l.canonicalId !== entity.id,
        );
        if (active) {
          throw new Error(`record ${recordId} already linked to ${active.canonicalId}`);
        }
        const already = links.find(
          (l) => l.recordId === recordId && l.canonicalId === entity.id && l.status === 'active',
        );
        if (!already) {
          links.push({
            id: nextId('link'),
            recordId,
            canonicalId: entity.id,
            status: 'active',
            createdAt: now,
            principal: input.principal,
          });
        }
      }

      events.push({
        id: nextId('merge-evt'),
        kind: 'merge',
        canonicalId: entity.id,
        recordIds: memberIds,
        reason: input.reason,
        principal: input.principal,
        createdAt: now,
      });
      return cloneCanonical(entity);
    },

    async unmerge(input: UnmergeInput) {
      const entity = canonicals.get(input.canonicalId);
      if (!entity) return undefined;
      if (!entity.memberIds.includes(input.recordId)) {
        throw new Error(`record ${input.recordId} não é membro ativo de ${input.canonicalId}`);
      }
      const now = clock();
      const remaining = entity.memberIds.filter((id) => id !== input.recordId);
      const updated: CanonicalEntity = {
        ...entity,
        memberIds: remaining,
        version: entity.version + 1,
        updatedAt: now,
      };
      if (remaining.length === 0) canonicals.delete(entity.id);
      else canonicals.set(entity.id, updated);

      for (const link of links) {
        if (
          link.canonicalId === input.canonicalId &&
          link.recordId === input.recordId &&
          link.status === 'active'
        ) {
          link.status = 'unmerged';
          link.unmergedAt = now;
          link.unmergeReason = input.reason;
          link.principal = input.principal ?? link.principal;
        }
      }

      events.push({
        id: nextId('merge-evt'),
        kind: 'unmerge',
        canonicalId: input.canonicalId,
        recordIds: [input.recordId],
        reason: input.reason,
        principal: input.principal,
        createdAt: now,
      });
      return remaining.length === 0 ? undefined : cloneCanonical(updated);
    },

    async getCanonical(id) {
      const c = canonicals.get(id);
      return c ? cloneCanonical(c) : undefined;
    },

    async listCanonicals(objectTypeId) {
      let rows = [...canonicals.values()];
      if (objectTypeId) rows = rows.filter((c) => c.objectTypeId === objectTypeId);
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return rows.map(cloneCanonical);
    },

    async linksForRecord(recordId) {
      return links
        .filter((l) => l.recordId === recordId)
        .map((l) => ({ ...l }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async listMergeEvents(canonicalId) {
      let rows = [...events];
      if (canonicalId) rows = rows.filter((e) => e.canonicalId === canonicalId);
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return rows.map((e) => ({ ...e, recordIds: [...e.recordIds] }));
    },

    async indexFingerprints(records: EntityRecord[]) {
      for (const rec of records) {
        const points = fingerprintRecord(rec);
        const idx = fingerprints.findIndex((f) => f.recordId === rec.id);
        const entry: IndexedFingerprint = {
          recordId: rec.id,
          objectTypeId: rec.objectTypeId,
          points,
        };
        if (idx >= 0) fingerprints[idx] = entry;
        else fingerprints.push(entry);
      }
    },

    async searchSimilar(query: EntityRecord): Promise<FingerprintMatch[]> {
      const fp = fingerprintRecord(query);
      return lookupFingerprintHits(fp, fingerprints, banned, query.id);
    },
  };
}
