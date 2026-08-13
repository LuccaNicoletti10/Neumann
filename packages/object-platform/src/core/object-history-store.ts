/**
 * object-platform — src/core/object-history-store.ts
 *
 * PEÇA 3 — grava e lê snapshots de objetos em platform_object_history
 * (tabela já criada em infra/sql/0003_history_ontology.sql; até agora
 * nenhum código escrevia nela).
 *
 * Responde: "como estava esse objeto quando a decisão foi tomada?"
 * asOf() reconstrói o estado vigente em qualquer timestamp.
 */

import type { OntologyId, OntologyVersionId, SqlClient } from 'contracts';

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
  createdAt: string;
}

export type AppendHistoryInput = Omit<ObjectHistoryEntry, 'id' | 'createdAt'>;

export interface ObjectHistoryStore {
  append(input: AppendHistoryInput): Promise<ObjectHistoryEntry>;
  /** Trilha completa de um objeto, mais antigo primeiro. */
  listByObject(objectId: string, limit?: number): Promise<ObjectHistoryEntry[]>;
  /** Estado vigente no instante `atIso` (último snapshot <= atIso). */
  asOf(
    ontologyId: OntologyId,
    objectTypeId: string,
    primaryKey: string,
    atIso: string,
  ): Promise<ObjectHistoryEntry | undefined>;
}

/* ------------------------------------------------------------------ */
/* PostgreSQL                                                          */
/* ------------------------------------------------------------------ */

export interface CreatePgObjectHistoryStoreOptions {
  sql: SqlClient;
  nextId?: (prefix: string) => string;
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
    createdAt: toIso(row.created_at),
  };
}

export function createPgObjectHistoryStore(
  opts: CreatePgObjectHistoryStoreOptions,
): ObjectHistoryStore {
  const { sql } = opts;
  const nextId =
    opts.nextId ?? ((p: string) => `${p}-${crypto.randomUUID()}`);

  return {
    async append(input) {
      const id = nextId('ohist');
      const res = await sql.query(
        `INSERT INTO platform_object_history (
           id, object_id, ontology_id, ontology_version_id, object_type_id,
           primary_key, version, properties, deleted, source, principal,
           operation, provenance
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb)
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

    async asOf(ontologyId, objectTypeId, primaryKey, atIso) {
      const res = await sql.query(
        `SELECT * FROM platform_object_history
         WHERE ontology_id = $1 AND object_type_id = $2 AND primary_key = $3
           AND created_at < ($4::timestamptz + interval '1 millisecond')
         ORDER BY created_at DESC, version DESC
         LIMIT 1`,
        [ontologyId, objectTypeId, primaryKey, atIso],
      );
      const row = (res.rows as Record<string, unknown>[])[0];
      return row ? rowToEntry(row) : undefined;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Memória (testes / gates)                                            */
/* ------------------------------------------------------------------ */

export function createMemoryObjectHistoryStore(opts?: {
  clock?: () => string;
  nextId?: (prefix: string) => string;
}): ObjectHistoryStore {
  const clock = opts?.clock ?? (() => new Date().toISOString());
  let seq = 0;
  const nextId = opts?.nextId ?? ((p: string) => `${p}-${++seq}`);
  const entries: ObjectHistoryEntry[] = [];

  return {
    async append(input) {
      const entry: ObjectHistoryEntry = {
        ...input,
        id: nextId('ohist'),
        createdAt: clock(),
      };
      entries.push(entry);
      return entry;
    },
    async listByObject(objectId, limit = 200) {
      return entries
        .filter((e) => e.objectId === objectId)
        .sort((a, b) => a.version - b.version)
        .slice(0, limit);
    },
    async asOf(ontologyId, objectTypeId, primaryKey, atIso) {
      return entries
        .filter(
          (e) =>
            e.ontologyId === ontologyId &&
            e.objectTypeId === objectTypeId &&
            e.primaryKey === primaryKey &&
            e.createdAt <= atIso,
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    },
  };
}
