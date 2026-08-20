/**
 * ingestion-runtime — PostgreSQL IngestionStore (0022 + 0023 inbox/nonce).
 */

import {
  assertIngestionMappingPin,
  assertRawEnvelope,
  type IngestionMappingPin,
  type IngestionQuarantineEntry,
  type IngestionRun,
  type RawEnvelope,
  type SqlClient,
  type TransactionManager,
} from 'contracts';

import { IngestionEventConflictError, IngestionLeaseHeldError, WebhookNonceReuseError } from './errors.js';
import type { AcceptWebhookResult, IngestionStore, QueuedEnvelope } from './ingestion-store.js';

function pinOf(value: unknown): IngestionMappingPin {
  assertIngestionMappingPin(value);
  return value;
}

function envelopeOf(value: unknown): RawEnvelope {
  assertRawEnvelope(value);
  return value;
}

function runFromRow(row: Record<string, unknown>): IngestionRun {
  return {
    id: String(row.id),
    kind: row.kind as IngestionRun['kind'],
    status: row.status as IngestionRun['status'],
    connectorId: String(row.connector_id),
    principal: String(row.principal),
    pin: pinOf(row.pin),
    cursor: row.cursor == null ? undefined : String(row.cursor),
    objectName: String(row.object_name),
    processedCount: Number(row.processed_count),
    quarantinedCount: Number(row.quarantined_count),
    workerId: row.worker_id == null ? undefined : String(row.worker_id),
    leaseUntil: row.lease_until == null ? undefined : new Date(String(row.lease_until)).toISOString(),
    error: row.error == null ? undefined : String(row.error),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function asTx(sql: SqlClient, transaction?: TransactionManager): TransactionManager {
  if (transaction) return transaction;
  const maybe = sql as SqlClient & Partial<TransactionManager>;
  if (typeof maybe.transaction === 'function') return maybe as TransactionManager;
  throw new Error('createPgIngestionStore.acceptWebhook requires sql.transaction');
}

export function createPgIngestionStore(opts: {
  sql: SqlClient;
  transaction?: TransactionManager;
}): IngestionStore {
  const { sql } = opts;
  return {
    async insertRun(run) {
      await sql.query(
        `INSERT INTO ingestion_runs (
           id, kind, status, connector_id, principal, pin, cursor, object_name,
           processed_count, quarantined_count, worker_id, lease_until, error, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          run.id,
          run.kind,
          run.status,
          run.connectorId,
          run.principal,
          JSON.stringify(run.pin),
          run.cursor ?? null,
          run.objectName,
          run.processedCount,
          run.quarantinedCount,
          run.workerId ?? null,
          run.leaseUntil ?? null,
          run.error ?? null,
          run.createdAt,
          run.updatedAt,
        ],
      );
    },
    async getRun(id) {
      const found = await sql.query(`SELECT * FROM ingestion_runs WHERE id = $1`, [id]);
      const row = found.rows[0] as Record<string, unknown> | undefined;
      return row ? runFromRow(row) : undefined;
    },
    async saveRun(run) {
      await sql.query(
        `UPDATE ingestion_runs SET
           status = $2, cursor = $3, processed_count = $4, quarantined_count = $5,
           worker_id = $6, lease_until = $7, error = $8, updated_at = $9
         WHERE id = $1`,
        [
          run.id,
          run.status,
          run.cursor ?? null,
          run.processedCount,
          run.quarantinedCount,
          run.workerId ?? null,
          run.leaseUntil ?? null,
          run.error ?? null,
          run.updatedAt,
        ],
      );
    },
    async acquireLease(input) {
      const result = await sql.query(
        `UPDATE ingestion_runs
         SET worker_id = $2,
             lease_until = $3,
             status = CASE WHEN status = 'pending' THEN 'running' ELSE status END,
             updated_at = $4
         WHERE id = $1
           AND (
             worker_id IS NULL
             OR lease_until IS NULL
             OR lease_until <= $4::timestamptz
             OR worker_id = $2
           )
         RETURNING *`,
        [input.runId, input.workerId, input.leaseUntil, input.now],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        const exists = await sql.query(`SELECT id FROM ingestion_runs WHERE id = $1`, [input.runId]);
        if (!exists.rows[0]) throw new Error(`unknown ingestion run: ${input.runId}`);
        throw new IngestionLeaseHeldError(input.runId);
      }
      return runFromRow(row);
    },
    async releaseLease(runId, workerId) {
      await sql.query(
        `UPDATE ingestion_runs SET worker_id = NULL, lease_until = NULL
         WHERE id = $1 AND worker_id = $2`,
        [runId, workerId],
      );
    },
    async enqueue(runId, envelope, id) {
      await sql.query(
        `INSERT INTO ingestion_envelopes (
           id, run_id, connector_id, source, source_event_id, source_schema_version,
           occurred_at, payload, metadata, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'queued')`,
        [
          id,
          runId,
          envelope.connectorId,
          envelope.source,
          envelope.sourceEventId,
          envelope.sourceSchemaVersion ?? null,
          envelope.occurredAt,
          JSON.stringify(envelope.payload),
          JSON.stringify(envelope.metadata),
        ],
      );
    },
    async listQueued(runId) {
      const found = await sql.query(
        `SELECT * FROM ingestion_envelopes WHERE run_id = $1 AND status = 'queued' ORDER BY id`,
        [runId],
      );
      return found.rows.map((row) => {
        const r = row as Record<string, unknown>;
        const envelope = envelopeOf({
          connectorId: String(r.connector_id),
          source: String(r.source),
          sourceEventId: String(r.source_event_id),
          sourceSchemaVersion: r.source_schema_version == null ? undefined : String(r.source_schema_version),
          occurredAt: String(r.occurred_at),
          payload: r.payload,
          metadata: r.metadata,
        });
        const queued: QueuedEnvelope = {
          id: String(r.id),
          runId: String(r.run_id),
          envelope,
          status: 'queued',
        };
        return queued;
      });
    },
    async markEnvelope(id, status) {
      await sql.query(`UPDATE ingestion_envelopes SET status = $2 WHERE id = $1`, [id, status]);
    },
    async insertQuarantine(entry) {
      await sql.query(
        `INSERT INTO ingestion_quarantine (
           id, run_id, source_event_id, envelope, reason, attempts, pin, created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)
         ON CONFLICT (run_id, source_event_id) DO NOTHING`,
        [
          entry.id,
          entry.runId,
          entry.envelope.sourceEventId,
          JSON.stringify(entry.envelope),
          entry.reason,
          entry.attempts,
          JSON.stringify(entry.pin),
          entry.createdAt,
        ],
      );
    },
    async getQuarantine(id) {
      const found = await sql.query(`SELECT * FROM ingestion_quarantine WHERE id = $1`, [id]);
      const row = found.rows[0] as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return rowToQuarantine(row);
    },
    async listQuarantine(runId) {
      const found = await sql.query(
        `SELECT * FROM ingestion_quarantine WHERE run_id = $1 ORDER BY id`,
        [runId],
      );
      return found.rows.map((row) => rowToQuarantine(row as Record<string, unknown>));
    },
    async acceptWebhook(input) {
      const txm = asTx(sql, opts.transaction);
      return txm.transaction(async (tx) => acceptWebhookTx(tx, input));
    },
    async listRunnable(limit, now) {
      const found = await sql.query(
        `SELECT id FROM ingestion_runs
         WHERE status = 'pending'
            OR (
              status = 'running'
              AND (worker_id IS NULL OR lease_until IS NULL OR lease_until <= $1::timestamptz)
            )
         ORDER BY created_at
         LIMIT $2`,
        [now, limit],
      );
      return found.rows.map((row) => String((row as { id: string }).id));
    },
    async purgeExpiredNonces(now) {
      const result = await sql.query(
        `DELETE FROM ingestion_webhook_nonces WHERE expires_at <= $1::timestamptz`,
        [now],
      );
      return result.rowCount ?? 0;
    },
  };
}

async function acceptWebhookTx(
  sql: SqlClient,
  input: {
    connectorId: string;
    sourceEventId: string;
    payloadHash: string;
    envelope: RawEnvelope;
    envelopeId: string;
    run: IngestionRun;
    now: string;
    nonce?: string;
    nonceExpiresAt?: string;
  },
): Promise<AcceptWebhookResult> {
  if (input.nonce) {
    const nonceInsert = await sql.query(
      `INSERT INTO ingestion_webhook_nonces (
         connector_id, nonce, source_event_id, payload_hash, run_id, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (connector_id, nonce) DO NOTHING
       RETURNING run_id, source_event_id, payload_hash`,
      [
        input.connectorId,
        input.nonce,
        input.sourceEventId,
        input.payloadHash,
        input.run.id,
        input.now,
        input.nonceExpiresAt ?? input.now,
      ],
    );
    if (!nonceInsert.rows[0]) {
      throw new WebhookNonceReuseError();
    }
  }

  const inbox = await sql.query(
    `SELECT payload_hash, run_id FROM ingestion_webhook_inbox
     WHERE connector_id = $1 AND source_event_id = $2`,
    [input.connectorId, input.sourceEventId],
  );
  const inboxRow = inbox.rows[0] as { payload_hash: string; run_id: string } | undefined;
  if (inboxRow) {
    if (inboxRow.payload_hash !== input.payloadHash) throw new IngestionEventConflictError();
    const runRow = await sql.query(`SELECT * FROM ingestion_runs WHERE id = $1`, [inboxRow.run_id]);
    const stored = runRow.rows[0] as Record<string, unknown> | undefined;
    if (!stored) throw new Error(`unknown ingestion run: ${inboxRow.run_id}`);
    return { run: runFromRow(stored), replayed: true };
  }

  await sql.query(
    `INSERT INTO ingestion_runs (
       id, kind, status, connector_id, principal, pin, cursor, object_name,
       processed_count, quarantined_count, worker_id, lease_until, error, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.run.id,
      input.run.kind,
      input.run.status,
      input.run.connectorId,
      input.run.principal,
      JSON.stringify(input.run.pin),
      input.run.cursor ?? null,
      input.run.objectName,
      input.run.processedCount,
      input.run.quarantinedCount,
      input.run.workerId ?? null,
      input.run.leaseUntil ?? null,
      input.run.error ?? null,
      input.run.createdAt,
      input.run.updatedAt,
    ],
  );
  await sql.query(
    `INSERT INTO ingestion_envelopes (
       id, run_id, connector_id, source, source_event_id, source_schema_version,
       occurred_at, payload, metadata, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'queued')`,
    [
      input.envelopeId,
      input.run.id,
      input.envelope.connectorId,
      input.envelope.source,
      input.envelope.sourceEventId,
      input.envelope.sourceSchemaVersion ?? null,
      input.envelope.occurredAt,
      JSON.stringify(input.envelope.payload),
      JSON.stringify(input.envelope.metadata),
    ],
  );
  await sql.query(
    `INSERT INTO ingestion_webhook_inbox (
       connector_id, source_event_id, payload_hash, run_id, envelope_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.connectorId,
      input.sourceEventId,
      input.payloadHash,
      input.run.id,
      input.envelopeId,
      input.now,
    ],
  );
  return { run: input.run, replayed: false };
}

function rowToQuarantine(row: Record<string, unknown>): IngestionQuarantineEntry {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    envelope: envelopeOf(row.envelope),
    reason: String(row.reason),
    attempts: Number(row.attempts),
    pin: pinOf(row.pin),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
