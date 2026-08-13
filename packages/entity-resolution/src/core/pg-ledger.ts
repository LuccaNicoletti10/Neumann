/**
 * entity-resolution — src/core/pg-ledger.ts
 * Postgres ledger for Passo 21 (er_match_audit / canonical / fingerprints).
 */

import type {
  CanonicalEntity,
  CanonicalEntityId,
  EntityRecord,
  FingerprintMatch,
  MatchAuditEntry,
  MatchAuditId,
  MatchReview,
  MergeCanonicalInput,
  MergeEvent,
  RecordReviewInput,
  ResolutionResult,
  ResolutionRunId,
  ScoreFeatures,
  SourceCanonicalLink,
  SqlClient,
  UnmergeInput,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import {
  blacklistHashes,
  fingerprintRecord,
  lookupFingerprintHits,
  type IndexedFingerprint,
} from './fingerprint.js';
import type { Clock, EntityLedger, IdGenerator } from './types.js';

export interface CreatePgEntityLedgerOptions {
  sql: SqlClient;
  clock?: Clock;
  nextId?: IdGenerator;
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function rowToAudit(row: Record<string, unknown>): MatchAuditEntry {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    leftId: String(row.left_id),
    rightId: String(row.right_id),
    objectTypeId: String(row.object_type_id),
    blockKey: String(row.block_key),
    score: Number(row.score),
    confidence: Number(row.confidence),
    features: asJson<ScoreFeatures>(row.features, { sharedExactKeys: [], propertyScores: {} }),
    modelVersion: String(row.model_version),
    decision: String(row.decision) as MatchAuditEntry['decision'],
    reason: String(row.reason),
    review: row.review == null ? undefined : asJson<MatchReview | undefined>(row.review, undefined),
    createdAt: iso(row.created_at),
  };
}

function rowToCanonical(row: Record<string, unknown>): CanonicalEntity {
  return {
    id: String(row.id),
    objectTypeId: String(row.object_type_id),
    memberIds: asJson<string[]>(row.member_ids, []),
    displayName: row.display_name == null ? undefined : String(row.display_name),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToLink(row: Record<string, unknown>): SourceCanonicalLink {
  return {
    id: String(row.id),
    recordId: String(row.record_id),
    canonicalId: String(row.canonical_id),
    status: String(row.status) as SourceCanonicalLink['status'],
    createdAt: iso(row.created_at),
    unmergedAt: row.unmerged_at == null ? undefined : iso(row.unmerged_at),
    unmergeReason: row.unmerge_reason == null ? undefined : String(row.unmerge_reason),
    principal: row.principal == null ? undefined : String(row.principal),
  };
}

function rowToEvent(row: Record<string, unknown>): MergeEvent {
  return {
    id: String(row.id),
    kind: String(row.kind) as MergeEvent['kind'],
    canonicalId: String(row.canonical_id),
    recordIds: asJson<string[]>(row.record_ids, []),
    reason: row.reason == null ? undefined : String(row.reason),
    principal: row.principal == null ? undefined : String(row.principal),
    createdAt: iso(row.created_at),
  };
}

export function createPgEntityLedger(opts: CreatePgEntityLedgerOptions): EntityLedger {
  const { sql } = opts;
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const banned = blacklistHashes();

  return {
    async commitRun(result: ResolutionResult): Promise<ResolutionRunId> {
      for (const c of result.candidates) {
        const id = nextId('audit');
        const createdAt = clock();
        await sql.query(
          `INSERT INTO er_match_audit (
             id, run_id, left_id, right_id, object_type_id, block_key,
             score, confidence, features, model_version, decision, reason, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
          [
            id,
            result.runId,
            c.leftId,
            c.rightId,
            c.objectTypeId,
            c.blockKey,
            c.score,
            c.confidence,
            JSON.stringify(c.features),
            c.ruleVersionId,
            c.decision,
            c.reason,
            createdAt,
          ],
        );
      }
      return result.runId;
    },

    async listMatchAudit(filter) {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filter?.runId) {
        params.push(filter.runId);
        where.push(`run_id = $${params.length}`);
      }
      if (filter?.decision) {
        params.push(filter.decision);
        where.push(`decision = $${params.length}`);
      }
      const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const res = await sql.query(
        `SELECT * FROM er_match_audit ${sqlWhere} ORDER BY created_at, id`,
        params,
      );
      return res.rows.map((r) => rowToAudit(r as Record<string, unknown>));
    },

    async getMatchAudit(id: MatchAuditId) {
      const res = await sql.query(`SELECT * FROM er_match_audit WHERE id = $1`, [id]);
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToAudit(row) : undefined;
    },

    async recordReview(input: RecordReviewInput) {
      const existing = await this.getMatchAudit(input.auditId);
      if (!existing) throw new Error(`MatchAuditEntry não encontrado: ${input.auditId}`);
      const review: MatchReview = {
        decision: input.decision,
        reviewer: input.reviewer,
        at: clock(),
        note: input.note,
      };
      await sql.query(`UPDATE er_match_audit SET review = $2::jsonb WHERE id = $1`, [
        input.auditId,
        JSON.stringify(review),
      ]);
      return { ...existing, review };
    },

    async mergeCanonical(input: MergeCanonicalInput) {
      const memberIds = [...new Set(input.memberIds)].sort();
      if (memberIds.length < 2) {
        throw new Error('mergeCanonical: precisa de pelo menos 2 memberIds');
      }
      const now = clock();
      let entity: CanonicalEntity;
      if (input.canonicalId) {
        const existing = await this.getCanonical(input.canonicalId);
        if (!existing) throw new Error(`CanonicalEntity não encontrado: ${input.canonicalId}`);
        if (existing.objectTypeId !== input.objectTypeId) {
          throw new Error('mergeCanonical: objectTypeId incompatível');
        }
        entity = {
          ...existing,
          memberIds: [...new Set([...existing.memberIds, ...memberIds])].sort(),
          displayName: input.displayName ?? existing.displayName,
          version: existing.version + 1,
          updatedAt: now,
        };
        await sql.query(
          `UPDATE er_canonical_entities
           SET member_ids = $2::jsonb, display_name = $3, version = $4, updated_at = $5
           WHERE id = $1`,
          [
            entity.id,
            JSON.stringify(entity.memberIds),
            entity.displayName ?? null,
            entity.version,
            entity.updatedAt,
          ],
        );
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
        await sql.query(
          `INSERT INTO er_canonical_entities (
             id, object_type_id, member_ids, display_name, version, created_at, updated_at
           ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7)`,
          [
            entity.id,
            entity.objectTypeId,
            JSON.stringify(entity.memberIds),
            entity.displayName ?? null,
            entity.version,
            entity.createdAt,
            entity.updatedAt,
          ],
        );
      }

      for (const recordId of memberIds) {
        const other = await sql.query(
          `SELECT * FROM er_source_canonical_links
           WHERE record_id = $1 AND status = 'active' AND canonical_id <> $2`,
          [recordId, entity.id],
        );
        if (other.rows[0]) {
          const row = other.rows[0] as Record<string, unknown>;
          throw new Error(`record ${recordId} already linked to ${String(row.canonical_id)}`);
        }
        const already = await sql.query(
          `SELECT id FROM er_source_canonical_links
           WHERE record_id = $1 AND canonical_id = $2 AND status = 'active'`,
          [recordId, entity.id],
        );
        if (!already.rows[0]) {
          await sql.query(
            `INSERT INTO er_source_canonical_links (
               id, record_id, canonical_id, status, created_at, principal
             ) VALUES ($1,$2,$3,'active',$4,$5)`,
            [nextId('link'), recordId, entity.id, now, input.principal ?? null],
          );
        }
      }

      await sql.query(
        `INSERT INTO er_merge_events (
           id, kind, canonical_id, record_ids, reason, principal, created_at
         ) VALUES ($1,'merge',$2,$3::jsonb,$4,$5,$6)`,
        [
          nextId('merge-evt'),
          entity.id,
          JSON.stringify(memberIds),
          input.reason ?? null,
          input.principal ?? null,
          now,
        ],
      );
      return entity;
    },

    async unmerge(input: UnmergeInput) {
      const entity = await this.getCanonical(input.canonicalId);
      if (!entity) return undefined;
      if (!entity.memberIds.includes(input.recordId)) {
        throw new Error(`record ${input.recordId} não é membro ativo de ${input.canonicalId}`);
      }
      const now = clock();
      const remaining = entity.memberIds.filter((id) => id !== input.recordId);
      if (remaining.length === 0) {
        await sql.query(`DELETE FROM er_canonical_entities WHERE id = $1`, [input.canonicalId]);
      } else {
        await sql.query(
          `UPDATE er_canonical_entities
           SET member_ids = $2::jsonb, version = $3, updated_at = $4
           WHERE id = $1`,
          [input.canonicalId, JSON.stringify(remaining), entity.version + 1, now],
        );
      }
      await sql.query(
        `UPDATE er_source_canonical_links
         SET status = 'unmerged', unmerged_at = $3, unmerge_reason = $4, principal = COALESCE($5, principal)
         WHERE canonical_id = $1 AND record_id = $2 AND status = 'active'`,
        [input.canonicalId, input.recordId, now, input.reason, input.principal ?? null],
      );
      await sql.query(
        `INSERT INTO er_merge_events (
           id, kind, canonical_id, record_ids, reason, principal, created_at
         ) VALUES ($1,'unmerge',$2,$3::jsonb,$4,$5,$6)`,
        [
          nextId('merge-evt'),
          input.canonicalId,
          JSON.stringify([input.recordId]),
          input.reason,
          input.principal ?? null,
          now,
        ],
      );
      if (remaining.length === 0) return undefined;
      return {
        ...entity,
        memberIds: remaining,
        version: entity.version + 1,
        updatedAt: now,
      };
    },

    async getCanonical(id: CanonicalEntityId) {
      const res = await sql.query(`SELECT * FROM er_canonical_entities WHERE id = $1`, [id]);
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToCanonical(row) : undefined;
    },

    async listCanonicals(objectTypeId) {
      const params: unknown[] = [];
      const where = objectTypeId ? (params.push(objectTypeId), `WHERE object_type_id = $1`) : '';
      const res = await sql.query(
        `SELECT * FROM er_canonical_entities ${where} ORDER BY id`,
        params,
      );
      return res.rows.map((r) => rowToCanonical(r as Record<string, unknown>));
    },

    async linksForRecord(recordId) {
      const res = await sql.query(
        `SELECT * FROM er_source_canonical_links WHERE record_id = $1 ORDER BY created_at, id`,
        [recordId],
      );
      return res.rows.map((r) => rowToLink(r as Record<string, unknown>));
    },

    async listMergeEvents(canonicalId) {
      const params: unknown[] = [];
      const where = canonicalId ? (params.push(canonicalId), `WHERE canonical_id = $1`) : '';
      const res = await sql.query(
        `SELECT * FROM er_merge_events ${where} ORDER BY created_at, id`,
        params,
      );
      return res.rows.map((r) => rowToEvent(r as Record<string, unknown>));
    },

    async indexFingerprints(records: EntityRecord[]) {
      for (const rec of records) {
        const points = fingerprintRecord(rec);
        await sql.query(`DELETE FROM er_fingerprints WHERE record_id = $1`, [rec.id]);
        for (const p of points) {
          await sql.query(
            `INSERT INTO er_fingerprints (record_id, object_type_id, hash, position)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (record_id, hash, position) DO NOTHING`,
            [rec.id, rec.objectTypeId, p.hash, p.position],
          );
        }
      }
    },

    async searchSimilar(query: EntityRecord): Promise<FingerprintMatch[]> {
      const fp = fingerprintRecord(query);
      const hashes = fp.map((p) => p.hash);
      if (hashes.length === 0) return [];
      const res = await sql.query<{
        record_id: string;
        object_type_id: string;
        hash: string | number;
        position: number;
      }>(
        `SELECT record_id, object_type_id, hash, position
         FROM er_fingerprints
         WHERE hash = ANY($1::bigint[])`,
        [hashes],
      );
      const byRecord = new Map<string, IndexedFingerprint>();
      for (const row of res.rows) {
        const recordId = String(row.record_id);
        const entry = byRecord.get(recordId) ?? {
          recordId,
          objectTypeId: String(row.object_type_id),
          points: [],
        };
        entry.points.push({ hash: Number(row.hash), position: Number(row.position) });
        byRecord.set(recordId, entry);
      }
      return lookupFingerprintHits(fp, [...byRecord.values()], banned, query.id);
    },
  };
}
