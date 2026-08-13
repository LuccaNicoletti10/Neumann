import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { OutboxRecord } from '../types.js';

export const OUTBOX_NOTIFY_CHANNEL = 'outbox';

export interface BusinessRow {
  table: string;
  row: Record<string, unknown>;
}

export interface OutboxTransaction {
  writeBusiness(table: string, row: Record<string, unknown>): void;
  insertOutbox(
    record: Omit<OutboxRecord, 'eventId' | 'attempts' | 'createdAt'> & {
      eventId?: string;
      attempts?: number;
      createdAt?: string;
    },
  ): void;
  commit(): Promise<void>;
  rollback(): void;
  crashBeforeCommit(): void;
}

export interface OutboxStore {
  begin(): OutboxTransaction;
  listUnpublished(): OutboxRecord[] | Promise<OutboxRecord[]>;
  markPublished(eventId: string): Promise<void>;
  incrementAttempts(eventId: string): Promise<void>;
  getBusinessRows(table: string): Record<string, unknown>[];
  onNotify(listener: (eventId: string) => void): () => void;
}

export class InMemoryTransactionalStore implements OutboxStore {
  private readonly business = new Map<string, Record<string, unknown>[]>();
  private readonly outbox = new Map<string, OutboxRecord>();
  private readonly emitter = new EventEmitter();

  begin(): OutboxTransaction {
    const pendingBusiness: BusinessRow[] = [];
    const pendingOutbox: OutboxRecord[] = [];
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
          createdAt: record.createdAt ?? new Date().toISOString(),
          attempts: record.attempts ?? 0,
        });
      },

      commit: async () => {
        if (committed || crashed) throw new Error('transaction closed');
        committed = true;
        for (const { table, row } of pendingBusiness) {
          const rows = this.business.get(table) ?? [];
          rows.push({ ...row });
          this.business.set(table, rows);
        }
        for (const record of pendingOutbox) {
          this.outbox.set(record.eventId, { ...record });
          this.emitter.emit(OUTBOX_NOTIFY_CHANNEL, record.eventId);
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
    return [...this.outbox.values()]
      .filter((r) => !r.publishedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async markPublished(eventId: string): Promise<void> {
    const record = this.outbox.get(eventId);
    if (!record) throw new Error(`outbox record not found: ${eventId}`);
    record.publishedAt = new Date().toISOString();
    this.outbox.set(eventId, record);
  }

  async incrementAttempts(eventId: string): Promise<void> {
    const record = this.outbox.get(eventId);
    if (!record) throw new Error(`outbox record not found: ${eventId}`);
    record.attempts += 1;
    this.outbox.set(eventId, record);
  }

  getBusinessRows(table: string): Record<string, unknown>[] {
    return [...(this.business.get(table) ?? [])];
  }

  onNotify(listener: (eventId: string) => void): () => void {
    this.emitter.on(OUTBOX_NOTIFY_CHANNEL, listener);
    return () => {
      this.emitter.off(OUTBOX_NOTIFY_CHANNEL, listener);
    };
  }
}
