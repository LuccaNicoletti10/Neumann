/**
 * event-bus — src/store/pg-outbox-repository.ts
 * OutboxRepository over the canonical outbox_events table (infra/sql/0001).
 * Used inside Action UnitOfWork on the same SqlClient/transaction.
 */

import { randomUUID } from 'node:crypto';
import type { OutboxInsertInput, OutboxRepository, SqlClient } from 'contracts';

import { OUTBOX_NOTIFY_CHANNEL } from './memory-outbox.js';

export function createPgOutboxRepository(opts: { sql: SqlClient }): OutboxRepository {
  const { sql } = opts;
  return {
    async insert(input: OutboxInsertInput): Promise<void> {
      const eventId = input.eventId ?? randomUUID();
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
  };
}
