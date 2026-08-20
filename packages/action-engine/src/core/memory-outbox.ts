/**
 * action-engine — src/core/memory-outbox.ts
 * In-memory OutboxRepository + OutboxDispatcher (ADR-0021).
 * Same claim/ack/dead-letter semantics as createPgOutboxRepository.
 */

import type {
  OutboxDispatchRecord,
  OutboxDispatcher,
  OutboxInsertInput,
  OutboxReader,
  OutboxRepository,
  OutboxRequest,
} from 'contracts';
import type { MemoryCheckpoint } from 'object-platform';
import { createUuidIdGenerator, restoreArray, type IdGenerator } from 'object-platform';

interface MemoryOutboxRow {
  eventId: string;
  topic: string;
  orderingKey: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  createdAt: string;
  attempts: number;
  status: OutboxDispatchRecord['status'];
  nextAttemptAt: string;
  leaseUntil?: string;
  lockedBy?: string;
  lastError?: string;
}

export type MemoryOutboxPort = OutboxRepository &
  OutboxReader &
  OutboxDispatcher &
  MemoryCheckpoint & {
    records: OutboxInsertInput[];
    rows: MemoryOutboxRow[];
  };

export function createMemoryOutboxRepository(opts?: {
  nextId?: IdGenerator;
  clock?: () => string;
}): MemoryOutboxPort {
  const nextId = opts?.nextId ?? createUuidIdGenerator();
  const clock = opts?.clock ?? (() => new Date().toISOString());
  const rows: MemoryOutboxRow[] = [];
  const records: OutboxInsertInput[] = [];

  function toDispatch(row: MemoryOutboxRow): OutboxDispatchRecord {
    return {
      eventId: row.eventId,
      topic: row.topic,
      orderingKey: row.orderingKey,
      payload: { ...row.payload },
      principal: row.principal,
      tenantId: row.tenantId,
      traceId: row.traceId,
      createdAt: row.createdAt,
      attempts: row.attempts,
      status: row.status,
    };
  }

  return {
    records,
    rows,
    async insert(input) {
      const eventId = input.eventId ?? nextId('evt');
      const now = clock();
      records.push({ ...input, eventId });
      rows.push({
        eventId,
        topic: input.topic,
        orderingKey: input.key,
        payload: { ...input.payload },
        principal: input.principal,
        tenantId: input.tenantId ?? 'default',
        traceId: input.traceId,
        createdAt: now,
        attempts: 0,
        status: 'PENDING',
        nextAttemptAt: now,
      });
    },
    async listRequests(filter) {
      return rows
        .filter((r) => (filter?.topic ? r.topic === filter.topic : true))
        .filter((r) => (filter?.traceId ? r.traceId === filter.traceId : true))
        .map<OutboxRequest>((r) => ({
          topic: r.topic,
          key: r.orderingKey,
          payload: { ...r.payload },
          principal: r.principal,
          traceId: r.traceId,
        }));
    },
    async claimBatch(input) {
      const claimed: OutboxDispatchRecord[] = [];
      for (const row of rows) {
        if (claimed.length >= input.limit) break;
        const due =
          (row.status === 'PENDING' || row.status === 'RETRYING') &&
          row.nextAttemptAt <= input.now;
        const expired =
          row.status === 'PROCESSING' &&
          row.leaseUntil !== undefined &&
          row.leaseUntil < input.now;
        if (!due && !expired) continue;
        row.status = 'PROCESSING';
        row.lockedBy = input.workerId;
        row.leaseUntil = new Date(Date.parse(input.now) + input.leaseMs).toISOString();
        row.attempts += 1;
        claimed.push(toDispatch(row));
      }
      return claimed;
    },
    async markDelivered(eventId, _now) {
      const row = rows.find((r) => r.eventId === eventId);
      if (!row) return;
      row.status = 'DELIVERED';
      row.lockedBy = undefined;
      row.leaseUntil = undefined;
      row.lastError = undefined;
    },
    async markRetry(eventId, nextAttemptAt, error, _now) {
      const row = rows.find((r) => r.eventId === eventId);
      if (!row) return;
      row.status = 'RETRYING';
      row.nextAttemptAt = nextAttemptAt;
      row.lastError = error;
      row.lockedBy = undefined;
      row.leaseUntil = undefined;
    },
    async markDeadLetter(eventId, error, _now) {
      const row = rows.find((r) => r.eventId === eventId);
      if (!row) return;
      row.status = 'DEAD_LETTER';
      row.lastError = error;
      row.lockedBy = undefined;
      row.leaseUntil = undefined;
    },
    async markUnhandled(eventId, _now) {
      const row = rows.find((r) => r.eventId === eventId);
      if (!row) return;
      row.status = 'UNHANDLED';
      row.lastError = 'no handler registered for topic';
      row.lockedBy = undefined;
      row.leaseUntil = undefined;
    },
    capture() {
      return {
        records: records.map((r) => ({ ...r })),
        rows: rows.map((r) => ({ ...r, payload: { ...r.payload } })),
      };
    },
    restore(snapshot: unknown) {
      const snap = snapshot as { records: OutboxInsertInput[]; rows: MemoryOutboxRow[] };
      restoreArray(records, snap.records ?? []);
      restoreArray(rows, snap.rows ?? []);
    },
  };
}
