/**
 * event-bus — durable writeback_executions (migration 0008).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { SqlClient } from 'contracts';

import type { WritebackExecutionRecord, WritebackRequest, WritebackResult } from './types.js';

export interface WritebackExecutionStore {
  start(req: WritebackRequest, requestHash: string): Promise<WritebackExecutionRecord>;
  finish(id: string, result: WritebackResult): Promise<void>;
  listByEvent(outboxEventId: string): Promise<WritebackExecutionRecord[]>;
}

export function hashWritebackRequest(req: WritebackRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        eventId: req.eventId,
        connectorId: req.connectorId,
        operation: req.operation,
        payload: req.payload,
      }),
    )
    .digest('hex');
}

export function createPgWritebackExecutionStore(opts: {
  sql: SqlClient;
}): WritebackExecutionStore {
  const { sql } = opts;

  return {
    async start(req, requestHash) {
      const id = randomUUID();
      const startedAt = new Date().toISOString();
      await sql.query(
        `INSERT INTO writeback_executions (
           id, outbox_event_id, connector_id, operation, request_hash,
           status, attempt, started_at, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,'STARTED',$6,$7,$8)`,
        [
          id,
          req.eventId,
          req.connectorId,
          req.operation,
          requestHash,
          req.attempt,
          startedAt,
          req.idempotencyKey,
        ],
      );
      return {
        id,
        outboxEventId: req.eventId,
        connectorId: req.connectorId,
        operation: req.operation,
        requestHash,
        status: 'STARTED',
        attempt: req.attempt,
        startedAt,
        idempotencyKey: req.idempotencyKey,
      };
    },

    async finish(id, result) {
      await sql.query(
        `UPDATE writeback_executions
         SET status = $2,
             finished_at = now(),
             error = $3,
             external_id = $4,
             external_operation_id = $5,
             response_hash = $6,
             response_metadata = $7::jsonb
         WHERE id = $1`,
        [
          id,
          result.ok ? 'SUCCEEDED' : 'FAILED',
          result.error ?? null,
          result.externalId ?? null,
          result.externalOperationId ?? null,
          result.responseHash ?? null,
          result.responseMetadata ? JSON.stringify(result.responseMetadata) : null,
        ],
      );
    },

    async listByEvent(outboxEventId) {
      const res = await sql.query(
        `SELECT * FROM writeback_executions
         WHERE outbox_event_id = $1
         ORDER BY attempt ASC, started_at ASC`,
        [outboxEventId],
      );
      return (res.rows as Record<string, unknown>[]).map((row) => {
        const rec: WritebackExecutionRecord = {
          id: String(row.id),
          outboxEventId: String(row.outbox_event_id),
          connectorId: String(row.connector_id),
          operation: String(row.operation),
          status: String(row.status) as WritebackExecutionRecord['status'],
          attempt: Number(row.attempt),
          startedAt: new Date(String(row.started_at)).toISOString(),
          idempotencyKey: String(row.idempotency_key),
        };
        if (row.request_hash != null) rec.requestHash = String(row.request_hash);
        if (row.external_id != null) rec.externalId = String(row.external_id);
        if (row.external_operation_id != null) {
          rec.externalOperationId = String(row.external_operation_id);
        }
        if (row.finished_at) rec.finishedAt = new Date(String(row.finished_at)).toISOString();
        if (row.error != null) rec.error = String(row.error);
        if (row.response_hash != null) rec.responseHash = String(row.response_hash);
        if (row.response_metadata) {
          rec.responseMetadata = row.response_metadata as Record<string, unknown>;
        }
        return rec;
      });
    },
  };
}
