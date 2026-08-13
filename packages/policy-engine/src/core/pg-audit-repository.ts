/**
 * policy-engine — src/core/pg-audit-repository.ts
 * PostgreSQL AuditRepository. Chain append uses pg_advisory_xact_lock so
 * previousSummaryHash is chosen atomically under concurrency.
 */

import type {
  AuditAppendInput,
  AuditEntry,
  AuditMessageType,
  AuditRepository,
  SqlClient,
  TransactionManager,
} from 'contracts';

import { computeLogHash, computeSummaryHash } from './audit-hash.js';

const AUDIT_CHAIN_LOCK = 8_041_715; // US20150188715-inspired stable advisory lock key

export interface CreatePgAuditRepositoryOptions {
  sql: SqlClient;
  /**
   * When set, each append/redact runs in its own transaction (standalone use).
   * Omit when `sql` is already a UnitOfWork transaction client.
   */
  transaction?: TransactionManager;
}

function rowToEntry(row: Record<string, unknown>): AuditEntry {
  const metadata = (row.metadata as Record<string, string>) ?? {};
  return {
    id: String(row.id),
    messageType: String(row.message_type) as AuditMessageType,
    eventData: row.event_data == null ? null : String(row.event_data),
    metadata,
    salt: row.salt == null ? null : String(row.salt),
    logHash: String(row.log_hash),
    summaryHash: String(row.summary_hash),
    previousSummaryHash:
      row.previous_summary_hash == null ? null : String(row.previous_summary_hash),
    at: new Date(String(row.created_at)).toISOString(),
    principal: row.principal == null ? undefined : String(row.principal),
  };
}

function metaExtras(metadata: Record<string, string>): {
  traceId: string | null;
  ontologyId: string | null;
  actionExecutionId: string | null;
} {
  return {
    traceId: metadata.traceId ?? metadata.trace_id ?? null,
    ontologyId: metadata.ontologyId ?? metadata.ontology_id ?? null,
    actionExecutionId:
      metadata.executionId ?? metadata.actionExecutionId ?? metadata.action_execution_id ?? null,
  };
}

export function createPgAuditRepository(
  opts: CreatePgAuditRepositoryOptions,
): AuditRepository {
  const { sql } = opts;

  async function inTx<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    if (opts.transaction) {
      return opts.transaction.transaction(fn);
    }
    return fn(sql);
  }

  async function headOn(client: SqlClient): Promise<AuditEntry | undefined> {
    const result = await client.query(
      `SELECT * FROM platform_audit_entries ORDER BY sequence_number DESC LIMIT 1`,
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  return {
    async appendChained(input: AuditAppendInput): Promise<AuditEntry> {
      return inTx(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
        const previous = await headOn(client);
        if (input.messageType === 'GENESIS' && previous) {
          throw new Error('audit já iniciado');
        }
        if (!previous && input.messageType !== 'GENESIS') {
          throw new Error('audit chain missing GENESIS');
        }
        const previousSummaryHash = previous ? previous.summaryHash : null;
        const logHash = computeLogHash(input.eventData, input.salt);
        const summaryHash = computeSummaryHash(
          logHash,
          input.metadata,
          previousSummaryHash,
        );
        const extras = metaExtras(input.metadata);
        const result = await client.query(
          `INSERT INTO platform_audit_entries (
             id, message_type, event_data, metadata, salt,
             log_hash, summary_hash, previous_summary_hash,
             principal, created_at, trace_id, ontology_id, action_execution_id
           ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            input.id,
            input.messageType,
            input.eventData,
            JSON.stringify(input.metadata),
            input.salt,
            logHash,
            summaryHash,
            previousSummaryHash,
            input.principal ?? null,
            input.at,
            extras.traceId,
            extras.ontologyId,
            extras.actionExecutionId,
          ],
        );
        return rowToEntry(result.rows[0] as Record<string, unknown>);
      });
    },

    async redact(entryId) {
      return inTx(async (client) => {
        const found = await client.query(
          `SELECT * FROM platform_audit_entries WHERE id = $1`,
          [entryId],
        );
        const row = found.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new Error(`entrada desconhecida: ${entryId}`);
        const current = rowToEntry(row);
        if (current.messageType === 'GENESIS' || current.messageType === 'COMMIT') {
          throw new Error('não é possível redigir GENESIS/COMMIT');
        }
        const updated = await client.query(
          `UPDATE platform_audit_entries
           SET message_type = 'REDACTED', event_data = NULL, salt = NULL
           WHERE id = $1
           RETURNING *`,
          [entryId],
        );
        return rowToEntry(updated.rows[0] as Record<string, unknown>);
      });
    },

    async list() {
      const result = await sql.query(
        `SELECT * FROM platform_audit_entries ORDER BY sequence_number ASC`,
      );
      return (result.rows as Record<string, unknown>[]).map(rowToEntry);
    },

    async head() {
      return headOn(sql);
    },

    async getById(entryId) {
      const result = await sql.query(
        `SELECT * FROM platform_audit_entries WHERE id = $1`,
        [entryId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToEntry(row) : undefined;
    },
  };
}
