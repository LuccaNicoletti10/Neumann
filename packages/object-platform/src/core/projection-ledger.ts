/**
 * Projection ledger — durable idempotency for ProjectionWriter.
 * Not ActionExecution. Unique key: source + ontology + sourceEventId.
 */

import type { ProjectionOperation, ProjectionResult, SqlClient } from 'contracts';

import type { MemoryCheckpoint } from './memory-checkpoint.js';
import { restoreMap } from './memory-checkpoint.js';

export interface ProjectionLedgerRecord {
  source: string;
  ontologyId: string;
  sourceEventId: string;
  payloadHash: string;
  operation: ProjectionOperation;
  result: ProjectionResult;
}

export interface ProjectionLedger {
  /**
   * Insert claiming the key. Concurrent callers: exactly one `claimed: true`.
   * WHY: claim before object writes so a replay cannot duplicate effects.
   */
  claim(input: {
    source: string;
    ontologyId: string;
    sourceEventId: string;
    payloadHash: string;
    operation: ProjectionOperation;
  }): Promise<{ claimed: boolean; record: ProjectionLedgerRecord }>;
  complete(record: ProjectionLedgerRecord): Promise<void>;
  /**
   * Drop a claim that has not been completed.
   * Memory UoW restore supersedes this; kept for adapter compatibility.
   */
  abandon?(input: { source: string; ontologyId: string; sourceEventId: string }): Promise<void>;
}

function ledgerKey(source: string, ontologyId: string, sourceEventId: string): string {
  return `${source}::${ontologyId}::${sourceEventId}`;
}

function placeholderResult(
  input: {
    source: string;
    ontologyId: string;
    sourceEventId: string;
    operation: ProjectionOperation;
  },
): ProjectionResult {
  return {
    status: 'applied',
    operation: input.operation,
    source: input.source,
    sourceEventId: input.sourceEventId,
    ontologyId: input.ontologyId,
  };
}

type LedgerWait = {
  promise: Promise<ProjectionLedgerRecord | 'abandoned'>;
  resolve: (value: ProjectionLedgerRecord | 'abandoned') => void;
};

/**
 * Memory ledger. WHY waiters exist: JS yields between claim and complete,
 * so a second caller must not observe a placeholder as a replay.
 * PG uniqueness waits on the index until the claiming transaction commits.
 */
export function createMemoryProjectionLedger(): ProjectionLedger & MemoryCheckpoint {
  const rows = new Map<string, ProjectionLedgerRecord>();
  const pending = new Map<string, LedgerWait>();

  function waitFor(): LedgerWait {
    let resolve!: (value: ProjectionLedgerRecord | 'abandoned') => void;
    const promise = new Promise<ProjectionLedgerRecord | 'abandoned'>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  return {
    async claim(input) {
      const key = ledgerKey(input.source, input.ontologyId, input.sourceEventId);
      for (;;) {
        const existing = rows.get(key);
        if (existing) return { claimed: false, record: existing };
        const inflight = pending.get(key);
        if (inflight) {
          const settled = await inflight.promise;
          if (settled === 'abandoned') continue;
          return { claimed: false, record: settled };
        }
        pending.set(key, waitFor());
        return {
          claimed: true,
          record: {
            source: input.source,
            ontologyId: input.ontologyId,
            sourceEventId: input.sourceEventId,
            payloadHash: input.payloadHash,
            operation: input.operation,
            result: placeholderResult(input),
          },
        };
      }
    },
    async complete(record) {
      const key = ledgerKey(record.source, record.ontologyId, record.sourceEventId);
      rows.set(key, record);
      pending.get(key)?.resolve(record);
      pending.delete(key);
    },
    async abandon(input) {
      const key = ledgerKey(input.source, input.ontologyId, input.sourceEventId);
      rows.delete(key);
      pending.get(key)?.resolve('abandoned');
      pending.delete(key);
    },

    capture() {
      return { rows: new Map(rows), waiting: new Set(pending.keys()) };
    },

    restore(snapshot: unknown) {
      const snap = snapshot as {
        rows: Map<string, ProjectionLedgerRecord>;
        waiting: Set<string>;
      };
      restoreMap(rows, snap.rows);
      // WHY: only claims opened by the aborted run are released. A waiter that
      // already existed when this run captured belongs to another operation;
      // abandoning it would report someone else's in-flight claim as retryable.
      for (const [key, waiter] of pending) {
        if (snap.waiting.has(key)) continue;
        waiter.resolve('abandoned');
        pending.delete(key);
      }
    },
  };
}

function rowToRecord(row: Record<string, unknown>): ProjectionLedgerRecord {
  return {
    source: String(row.source),
    ontologyId: String(row.ontology_id),
    sourceEventId: String(row.source_event_id),
    payloadHash: String(row.payload_hash),
    operation: String(row.operation) as ProjectionOperation,
    result: (row.result as ProjectionResult) ?? placeholderResult({
      source: String(row.source),
      ontologyId: String(row.ontology_id),
      sourceEventId: String(row.source_event_id),
      operation: String(row.operation) as ProjectionOperation,
    }),
  };
}

export function createPgProjectionLedger(opts: { sql: SqlClient }): ProjectionLedger {
  const { sql } = opts;
  return {
    async claim(input) {
      const inserted = await sql.query(
        `INSERT INTO projection_ledger (
           source, ontology_id, source_event_id, payload_hash, operation, result
         ) VALUES ($1,$2,$3,$4,$5,'{}'::jsonb)
         ON CONFLICT (source, ontology_id, source_event_id) DO NOTHING
         RETURNING *`,
        [
          input.source,
          input.ontologyId,
          input.sourceEventId,
          input.payloadHash,
          input.operation,
        ],
      );
      const row = (inserted.rows as Record<string, unknown>[])[0];
      if (row) {
        return { claimed: true, record: rowToRecord(row) };
      }
      const existing = await sql.query(
        `SELECT * FROM projection_ledger
         WHERE source = $1 AND ontology_id = $2 AND source_event_id = $3`,
        [input.source, input.ontologyId, input.sourceEventId],
      );
      const found = (existing.rows as Record<string, unknown>[])[0];
      if (!found) {
        throw new Error('projection ledger claim missed both insert and select');
      }
      return { claimed: false, record: rowToRecord(found) };
    },
    async complete(record) {
      await sql.query(
        `UPDATE projection_ledger
         SET payload_hash = $4, operation = $5, result = $6::jsonb
         WHERE source = $1 AND ontology_id = $2 AND source_event_id = $3`,
        [
          record.source,
          record.ontologyId,
          record.sourceEventId,
          record.payloadHash,
          record.operation,
          JSON.stringify(record.result),
        ],
      );
    },
  };
}
