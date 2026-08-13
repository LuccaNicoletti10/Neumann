import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { OutboxRecord } from '../types.js';
import {
  OUTBOX_NOTIFY_CHANNEL,
  type OutboxStore,
  type OutboxTransaction,
} from './memory-outbox.js';

const { Pool } = pg;

/**
 * @deprecated Do not auto-create a second outbox. Official schema is
 * `infra/sql/0001_outbox.sql` (`outbox_events`). Kept as IF NOT EXISTS
 * matching that migration so `init()` stays compatible.
 */
export const OUTBOX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  ordering_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  principal TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
  ON outbox_events (created_at)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS outbox_events_key_idx
  ON outbox_events (ordering_key, created_at);
`;

interface PendingOutbox {
  eventId: string;
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  attempts: number;
}

export class PostgresOutboxStore implements OutboxStore {
  private readonly pool: pg.Pool;
  private readonly emitter = new EventEmitter();
  private readonly listener: pg.Pool;
  private listening = false;
  private readonly schema?: string;

  constructor(connectionString: string, opts?: { schema?: string }) {
    this.pool = new Pool({ connectionString });
    this.listener = new Pool({ connectionString });
    if (opts?.schema) this.schema = opts.schema;
  }

  private async withSearchPath(client: pg.PoolClient): Promise<void> {
    if (this.schema) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.schema)) {
        throw new Error(`invalid schema: ${this.schema}`);
      }
      await client.query(`SET search_path TO "${this.schema}"`);
    }
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.withSearchPath(client);
      await client.query(OUTBOX_SCHEMA_SQL);
    } finally {
      client.release();
    }
    if (!this.listening) {
      const client = await this.listener.connect();
      await client.query(`LISTEN ${OUTBOX_NOTIFY_CHANNEL}`);
      client.on('notification', (msg) => {
        if (msg.channel === OUTBOX_NOTIFY_CHANNEL && msg.payload) {
          this.emitter.emit(OUTBOX_NOTIFY_CHANNEL, msg.payload);
        }
      });
      this.listening = true;
    }
  }

  begin(): OutboxTransaction {
    const pendingOutbox: PendingOutbox[] = [];
    let committed = false;
    let crashed = false;

    return {
      writeBusiness: () => {
        if (committed || crashed) throw new Error('transaction closed');
        // Domain writes belong on ObjectRepository / ActionExecutionStore /
        // AuditRepository — not a generic business_data table.
      },

      insertOutbox: (record) => {
        if (committed || crashed) throw new Error('transaction closed');
        pendingOutbox.push({
          eventId: record.eventId ?? randomUUID(),
          topic: record.topic,
          key: record.key,
          payload: record.payload,
          principal: record.principal,
          tenantId: record.tenantId,
          traceId: record.traceId,
          attempts: record.attempts ?? 0,
        });
      },

      commit: async () => {
        if (committed || crashed) throw new Error('transaction closed');
        committed = true;
        const client = await this.pool.connect();
        try {
          await this.withSearchPath(client);
          await client.query('BEGIN');
          for (const record of pendingOutbox) {
            await client.query(
              `INSERT INTO outbox_events
                (event_id, topic, ordering_key, payload, principal, tenant_id, trace_id, attempts)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                record.eventId,
                record.topic,
                record.key,
                record.payload,
                record.principal,
                record.tenantId,
                record.traceId,
                record.attempts,
              ],
            );
            await client.query(`SELECT pg_notify($1, $2)`, [
              OUTBOX_NOTIFY_CHANNEL,
              record.eventId,
            ]);
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },

      rollback: () => {
        if (crashed) throw new Error('transaction closed');
        committed = true;
      },

      crashBeforeCommit: () => {
        if (committed || crashed) throw new Error('transaction closed');
        crashed = true;
      },
    };
  }

  async listUnpublished(): Promise<OutboxRecord[]> {
    return this.listUnpublishedAsync();
  }

  async listUnpublishedAsync(): Promise<OutboxRecord[]> {
    const client = await this.pool.connect();
    try {
      await this.withSearchPath(client);
      const result = await client.query(
        `SELECT event_id, topic, ordering_key, payload, principal, tenant_id, trace_id,
                created_at, published_at, attempts
         FROM outbox_events
         WHERE published_at IS NULL
         ORDER BY created_at ASC`,
      );
      return result.rows.map(rowToRecord);
    } finally {
      client.release();
    }
  }

  async markPublished(eventId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.withSearchPath(client);
      await client.query(
        'UPDATE outbox_events SET published_at = NOW() WHERE event_id = $1',
        [eventId],
      );
    } finally {
      client.release();
    }
  }

  async incrementAttempts(eventId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.withSearchPath(client);
      await client.query(
        'UPDATE outbox_events SET attempts = attempts + 1 WHERE event_id = $1',
        [eventId],
      );
    } finally {
      client.release();
    }
  }

  getBusinessRows(_table: string): Record<string, unknown>[] {
    return [];
  }

  onNotify(listener: (eventId: string) => void): () => void {
    this.emitter.on(OUTBOX_NOTIFY_CHANNEL, listener);
    return () => {
      this.emitter.off(OUTBOX_NOTIFY_CHANNEL, listener);
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.listener.end();
  }
}

function rowToRecord(row: pg.QueryResultRow): OutboxRecord {
  const record: OutboxRecord = {
    eventId: String(row.event_id),
    topic: String(row.topic),
    key: String(row.ordering_key),
    payload: row.payload as Record<string, unknown>,
    principal: String(row.principal),
    tenantId: String(row.tenant_id),
    traceId: String(row.trace_id),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    attempts: Number(row.attempts),
  };
  if (row.published_at) {
    record.publishedAt = new Date(row.published_at as string | Date).toISOString();
  }
  return record;
}

export function createPostgresOutboxStore(connectionString?: string): PostgresOutboxStore {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for PostgresOutboxStore');
  }
  return new PostgresOutboxStore(url);
}
