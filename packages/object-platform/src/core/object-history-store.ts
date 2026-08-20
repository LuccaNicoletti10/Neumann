/**
 * object-platform — src/core/object-history-store.ts
 *
 * PEÇA 3 — grava e lê snapshots de objetos em platform_object_history
 * (tabela já criada em infra/sql/0003_history_ontology.sql; até agora
 * nenhum código escrevia nela).
 *
 * Responde: "qual era o mundo neste instante?"
 * Snapshots são pós-mutação; asOf(t) devolve o último snapshot <= t.
 */

import type { OntologyId, OntologyVersionId, SqlClient } from 'contracts';

import { createSystemClock, createUuidIdGenerator } from './determinism.js';
import type { MemoryCheckpoint } from './memory-checkpoint.js';
import { restoreArray } from './memory-checkpoint.js';
import type { Clock } from './types.js';

export interface ObjectHistoryEntry {
  id: string;
  objectId: string;
  ontologyId: OntologyId;
  ontologyVersionId?: OntologyVersionId;
  objectTypeId: string;
  primaryKey: string;
  version: number;
  properties: Record<string, unknown>;
  deleted: boolean;
  source?: string;
  principal?: string;
  operation: 'create' | 'update' | 'delete' | 'restore';
  provenance?: Record<string, unknown>;
  /**
   * Set only by a declared object migration. WHY: the trail must show that the
   * schema version changed, not just that properties changed.
   */
  fromOntologyVersionId?: OntologyVersionId;
  toOntologyVersionId?: OntologyVersionId;
  createdAt: string;
  /** Global history sequence (ADR-0021). Total order across replicas. */
  seq: number;
}

export type AppendHistoryInput = Omit<ObjectHistoryEntry, 'id' | 'createdAt' | 'seq'>;

export interface HistoryWatermark {
  seq: number;
  recordedAt: string;
}

export interface ObjectHistoryStore {
  append(input: AppendHistoryInput): Promise<ObjectHistoryEntry> | ObjectHistoryEntry;
  /** Trilha completa de um objeto, mais antigo primeiro. */
  listByObject(
    objectId: string,
    limit?: number,
  ): Promise<ObjectHistoryEntry[]> | ObjectHistoryEntry[];
  /**
   * Estado vigente no watermark. `atSeq` is the replica-safe frontier;
   * `atIso` remains for timestamp-only callers.
   */
  asOf(
    ontologyId: OntologyId,
    objectTypeId: string,
    primaryKey: string,
    atIso: string,
    atSeq?: number,
  ): Promise<ObjectHistoryEntry | undefined> | ObjectHistoryEntry | undefined;
  watermark(): Promise<HistoryWatermark> | HistoryWatermark;
}

/* ------------------------------------------------------------------ */
/* PostgreSQL                                                          */
/* ------------------------------------------------------------------ */

export interface CreatePgObjectHistoryStoreOptions {
  sql: SqlClient;
  nextId?: (prefix: string) => string;
  clock?: Clock;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function rowToEntry(row: Record<string, unknown>): ObjectHistoryEntry {
  return {
    id: String(row.id),
    objectId: String(row.object_id),
    ontologyId: String(row.ontology_id),
    ontologyVersionId: row.ontology_version_id == null ? undefined : String(row.ontology_version_id),
    objectTypeId: String(row.object_type_id),
    primaryKey: String(row.primary_key),
    version: Number(row.version),
    properties: (row.properties as Record<string, unknown>) ?? {},
    deleted: Boolean(row.deleted),
    source: row.source == null ? undefined : String(row.source),
    principal: row.principal == null ? undefined : String(row.principal),
    operation: String(row.operation) as ObjectHistoryEntry['operation'],
    provenance: (row.provenance as Record<string, unknown>) ?? undefined,
    fromOntologyVersionId:
      row.from_ontology_version_id == null ? undefined : String(row.from_ontology_version_id),
    toOntologyVersionId:
      row.to_ontology_version_id == null ? undefined : String(row.to_ontology_version_id),
    createdAt: toIso(row.created_at),
    seq: Number(row.seq),
  };
}

export function createPgObjectHistoryStore(
  opts: CreatePgObjectHistoryStoreOptions,
): ObjectHistoryStore {
  const { sql } = opts;
  const nextId = opts.nextId ?? createUuidIdGenerator();
  const clock = opts.clock ?? createSystemClock();

  return {
    async append(input) {
      const id = nextId('ohist');
      const createdAt = clock();
      const res = await sql.query(
         `INSERT INTO platform_object_history (
           id, object_id, ontology_id, ontology_version_id, object_type_id,
           primary_key, version, properties, deleted, source, principal,
           operation, provenance, from_ontology_version_id, to_ontology_version_id,
           created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::timestamptz)
         RETURNING *`,
        [
          id,
          input.objectId,
          input.ontologyId,
          input.ontologyVersionId ?? null,
          input.objectTypeId,
          input.primaryKey,
          input.version,
          JSON.stringify(input.properties ?? {}),
          input.deleted,
          input.source ?? null,
          input.principal ?? null,
          input.operation,
          input.provenance ? JSON.stringify(input.provenance) : null,
          input.fromOntologyVersionId ?? null,
          input.toOntologyVersionId ?? null,
          createdAt,
        ],
      );
      return rowToEntry(res.rows[0] as Record<string, unknown>);
    },

    async listByObject(objectId, limit = 200) {
      const res = await sql.query(
        `SELECT * FROM platform_object_history
         WHERE object_id = $1
         ORDER BY version ASC, created_at ASC
         LIMIT $2`,
        [objectId, limit],
      );
      return (res.rows as Record<string, unknown>[]).map(rowToEntry);
    },

    async asOf(ontologyId, objectTypeId, primaryKey, atIso, atSeq) {
      if (atSeq != null) {
        const res = await sql.query(
          `SELECT * FROM platform_object_history
           WHERE ontology_id = $1 AND object_type_id = $2 AND primary_key = $3
             AND seq <= $4
           ORDER BY seq DESC
           LIMIT 1`,
          [ontologyId, objectTypeId, primaryKey, atSeq],
        );
        const row = (res.rows as Record<string, unknown>[])[0];
        return row ? rowToEntry(row) : undefined;
      }
      const res = await sql.query(
        `SELECT * FROM platform_object_history
         WHERE ontology_id = $1 AND object_type_id = $2 AND primary_key = $3
           AND created_at <= $4::timestamptz
         ORDER BY created_at DESC, version DESC
         LIMIT 1`,
        [ontologyId, objectTypeId, primaryKey, atIso],
      );
      const row = (res.rows as Record<string, unknown>[])[0];
      return row ? rowToEntry(row) : undefined;
    },

    async watermark() {
      const res = await sql.query(
        `SELECT COALESCE(MAX(seq), 0)::bigint AS seq FROM platform_object_history`,
      );
      const row = res.rows[0] as { seq: string | number } | undefined;
      return { seq: Number(row?.seq ?? 0), recordedAt: clock() };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Memória (testes / gates)                                            */
/* ------------------------------------------------------------------ */

export function createMemoryObjectHistoryStore(opts?: {
  clock?: () => string;
  nextId?: (prefix: string) => string;
}): ObjectHistoryStore & MemoryCheckpoint {
  const clock = opts?.clock ?? (() => new Date().toISOString());
  let idSeq = 0;
  let historySeq = 0;
  const nextId = opts?.nextId ?? ((p: string) => `${p}-${++idSeq}`);
  const entries: ObjectHistoryEntry[] = [];

  return {
    append(input) {
      historySeq += 1;
      const entry: ObjectHistoryEntry = {
        ...input,
        id: nextId('ohist'),
        createdAt: clock(),
        seq: historySeq,
      };
      entries.push(entry);
      return entry;
    },
    listByObject(objectId, limit = 200) {
      return entries
        .filter((e) => e.objectId === objectId)
        .sort((a, b) => a.version - b.version)
        .slice(0, limit);
    },
    asOf(ontologyId, objectTypeId, primaryKey, atIso, atSeq) {
      return entries
        .filter((e) => {
          if (e.ontologyId !== ontologyId || e.objectTypeId !== objectTypeId || e.primaryKey !== primaryKey) {
            return false;
          }
          if (atSeq != null) return e.seq <= atSeq;
          return e.createdAt <= atIso;
        })
        .sort((a, b) => {
          if (atSeq != null) return b.seq - a.seq;
          if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
          return b.version - a.version;
        })[0];
    },
    watermark() {
      return { seq: historySeq, recordedAt: clock() };
    },

    capture() {
      return entries.map((e) => ({ ...e, properties: { ...e.properties } }));
    },

    restore(snapshot: unknown) {
      restoreArray(entries, snapshot as ObjectHistoryEntry[]);
      historySeq = entries.reduce((max, e) => Math.max(max, e.seq), 0);
    },
  };
}
