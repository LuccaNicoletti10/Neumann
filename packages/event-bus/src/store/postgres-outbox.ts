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

export const OUTBOX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS business_data (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox (
  event_id UUID PRIMARY KEY,
  topic TEXT NOT NULL,
  ordering_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  principal TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
  ON outbox (created_at)
  WHERE published_at IS NULL;
`;

interface PendingBusiness {
  table: string;
  row: Record<string, unknown>;
}

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

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.listener = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(OUTBOX_SCHEMA_SQL);
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
    const pendingBusiness: PendingBusiness[] = [];
    const pendingOutbox: PendingOutbox[] = [];
    let committed = false;
    let crashed = false;

    return {
      writeBusiness: (table, row) => {
        if (committed || crashed) throw new Error('transaction closed');
        pendingBusiness.push({ table, row });
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
          await client.query('BEGIN');
          for (const { table, row } of pendingBusiness) {
            await client.query(
              'INSERT INTO business_data (table_name, row_data) VALUES ($1, $2)',
              [table, row],
            );
          }
          for (const record of pendingOutbox) {
            await client.query(
              `INSERT INTO outbox
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
            await client.query(`NOTIFY ${OUTBOX_NOTIFY_CHANNEL}, $1`, [record.eventId]);
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
        if (committed || crashed) throw new Error('transaction closed');
        committed = true;
      },

      crashBeforeCommit: () => {
        if (committed || crashed) throw new Error('transaction closed');
        crashed = true;
      },
    };
  }

  listUnpublished(): OutboxRecord[] {
    throw new Error('use listUnpublishedAsync for PostgresOutboxStore');
  }

  async listUnpublishedAsync(): Promise<OutboxRecord[]> {
    const result = await this.pool.query(
      `SELECT event_id, topic, ordering_key, payload, principal, tenant_id, trace_id,
              created_at, published_at, attempts
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY created_at ASC`,
    );
    return result.rows.map(rowToRecord);
  }

  async markPublished(eventId: string): Promise<void> {
    await this.pool.query(
      'UPDATE outbox SET published_at = NOW() WHERE event_id = $1',
      [eventId],
    );
  }

  async incrementAttempts(eventId: string): Promise<void> {
    await this.pool.query(
      'UPDATE outbox SET attempts = attempts + 1 WHERE event_id = $1',
      [eventId],
    );
  }

  getBusinessRows(_table: string): Record<string, unknown>[] {
    throw new Error('use getBusinessRowsAsync for PostgresOutboxStore');
  }

  async getBusinessRowsAsync(table: string): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query(
      'SELECT row_data FROM business_data WHERE table_name = $1 ORDER BY id ASC',
      [table],
    );
    return result.rows.map((r) => r.row_data as Record<string, unknown>);
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
