/**
 * event-bus — src/store/pg-outbox-repository.ts
 * OutboxRepository + OutboxDispatcher over outbox_events (ADR-0021).
 * Insert and claim share one table. No second production outbox.
 */

import type {
  OutboxDispatchRecord,
  OutboxDispatcher,
  OutboxInsertInput,
  OutboxReader,
  OutboxRepository,
  OutboxRequest,
  SqlClient,
} from 'contracts';
import { createUuidIdGenerator, type IdGenerator } from 'object-platform';

import { OUTBOX_NOTIFY_CHANNEL } from './memory-outbox.js';

export type PgOutboxPort = OutboxRepository & OutboxReader & OutboxDispatcher;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function rowToDispatch(row: Record<string, unknown>): OutboxDispatchRecord {
  return {
    eventId: String(row.event_id),
    topic: String(row.topic),
    orderingKey: String(row.ordering_key),
    payload: (row.payload as Record<string, unknown>) ?? {},
    principal: String(row.principal),
    tenantId: String(row.tenant_id ?? 'default'),
    traceId: String(row.trace_id),
    createdAt: toIso(row.created_at),
    attempts: Number(row.attempts ?? 0),
    status: String(row.status ?? 'PENDING') as OutboxDispatchRecord['status'],
  };
}

async function inTx<T>(
  sql: SqlClient & { transaction?: <U>(fn: (tx: SqlClient) => Promise<U>) => Promise<U> },
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  if (sql.transaction) return sql.transaction(fn);
  return fn(sql);
}

export function createPgOutboxRepository(opts: {
  sql: SqlClient & { transaction?: <T>(fn: (tx: SqlClient) => Promise<T>) => Promise<T> };
  nextId?: IdGenerator;
}): PgOutboxPort {
  const { sql } = opts;
  const nextId = opts.nextId ?? createUuidIdGenerator();

  return {
    async insert(input: OutboxInsertInput): Promise<void> {
      const eventId = input.eventId ?? nextId('evt');
      await sql.query(
        `INSERT INTO outbox_events
           (event_id, topic, ordering_key, payload, principal, tenant_id, trace_id,
            attempts, status, next_attempt_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,0,'PENDING', now())`,
        [
          eventId,
          input.topic,
          input.key,
          JSON.stringify(input.payload),
          input.principal,
          input.tenantId ?? 'default',
          input.traceId,
        ],
      );
      await sql.query(`SELECT pg_notify($1, $2)`, [OUTBOX_NOTIFY_CHANNEL, eventId]);
    },

    async listRequests(filter): Promise<readonly OutboxRequest[]> {
      const result = await sql.query<{
        topic: string;
        ordering_key: string;
        payload: Record<string, unknown>;
        principal: string;
        trace_id: string;
      }>(
        `SELECT topic, ordering_key, payload, principal, trace_id
           FROM outbox_events
          WHERE ($1::text IS NULL OR topic = $1)
            AND ($2::text IS NULL OR trace_id = $2)
          ORDER BY created_at, event_id`,
        [filter?.topic ?? null, filter?.traceId ?? null],
      );
      return result.rows.map((r) => ({
        topic: r.topic,
        key: r.ordering_key,
        payload: r.payload,
        principal: r.principal,
        traceId: r.trace_id,
      }));
    },

    async claimBatch(input) {
      return inTx(sql, async (tx) => {
        const res = await tx.query(
          `WITH batch AS (
             SELECT event_id
             FROM outbox_events
             WHERE (
                 (status IN ('PENDING', 'RETRYING') AND next_attempt_at <= $4::timestamptz)
                 OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until < $4::timestamptz)
               )
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
           )
           UPDATE outbox_events AS o
           SET status = 'PROCESSING',
               locked_at = $4::timestamptz,
               locked_by = $2,
               lease_until = $4::timestamptz + ($3::int * interval '1 millisecond'),
               last_attempt_at = $4::timestamptz,
               attempts = o.attempts + 1
           FROM batch
           WHERE o.event_id = batch.event_id
           RETURNING o.*`,
          [input.limit, input.workerId, input.leaseMs, input.now],
        );
        return (res.rows as Record<string, unknown>[]).map(rowToDispatch);
      });
    },

    async markDelivered(eventId, now) {
      await inTx(sql, (tx) =>
        tx.query(
          `UPDATE outbox_events
           SET status = 'DELIVERED',
               published_at = $2::timestamptz,
               delivered_at = $2::timestamptz,
               locked_at = NULL,
               locked_by = NULL,
               lease_until = NULL,
               last_error = NULL
           WHERE event_id = $1`,
          [eventId, now],
        ),
      );
    },

    async markRetry(eventId, nextAttemptAt, error, _now) {
      await inTx(sql, (tx) =>
        tx.query(
          `UPDATE outbox_events
           SET status = 'RETRYING',
               published_at = NULL,
               next_attempt_at = $2::timestamptz,
               last_error = $3,
               locked_at = NULL,
               locked_by = NULL,
               lease_until = NULL
           WHERE event_id = $1`,
          [eventId, nextAttemptAt, error],
        ),
      );
    },

    async markDeadLetter(eventId, error, now) {
      await inTx(sql, (tx) =>
        tx.query(
          `UPDATE outbox_events
           SET status = 'DEAD_LETTER',
               published_at = NULL,
               dead_lettered_at = $3::timestamptz,
               last_error = $2,
               locked_at = NULL,
               locked_by = NULL,
               lease_until = NULL
           WHERE event_id = $1`,
          [eventId, error, now],
        ),
      );
    },

    async markUnhandled(eventId, _now) {
      await inTx(sql, (tx) =>
        tx.query(
          `UPDATE outbox_events
           SET status = 'UNHANDLED',
               published_at = NULL,
               locked_at = NULL,
               locked_by = NULL,
               lease_until = NULL,
               last_error = 'no handler registered for topic'
           WHERE event_id = $1`,
          [eventId],
        ),
      );
    },
  };
}
