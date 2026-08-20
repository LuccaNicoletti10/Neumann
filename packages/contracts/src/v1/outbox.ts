/**
 * contracts — src/v1/outbox.ts
 * Canonical transactional outbox insert (table: outbox_events).
 *
 * Side effects (write-back, webhooks) are requested here inside the Action
 * UnitOfWork. External HTTP runs AFTER commit, via outbox workers.
 */

export interface OutboxInsertInput {
  eventId?: string;
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId?: string;
  traceId: string;
}

export interface OutboxRepository {
  insert(input: OutboxInsertInput): Promise<void>;
}

/** One accepted outbox request, as the writer submitted it. */
export interface OutboxRequest {
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  principal: string;
  traceId: string;
}

/**
 * Read side of the outbox, for parity assertions across adapters (ADR-0013).
 * Not a queue consumer: dispatch state stays inside the publisher.
 */
export interface OutboxReader {
  listRequests(filter?: { topic?: string; traceId?: string }): Promise<readonly OutboxRequest[]>;
}

export type OutboxDispatchStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'RETRYING'
  | 'DELIVERED'
  | 'DEAD_LETTER'
  | 'UNHANDLED';

export interface OutboxDispatchRecord {
  eventId: string;
  topic: string;
  orderingKey: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  createdAt: string;
  attempts: number;
  status: OutboxDispatchStatus;
}

/**
 * Claim/ack side of the same outbox_events table (ADR-0021).
 * Worker and repository share this port. Not a second queue.
 */
export interface OutboxDispatcher {
  claimBatch(input: {
    workerId: string;
    now: string;
    leaseMs: number;
    limit: number;
  }): Promise<OutboxDispatchRecord[]>;
  markDelivered(eventId: string, now: string): Promise<void>;
  markRetry(eventId: string, nextAttemptAt: string, error: string, now: string): Promise<void>;
  markDeadLetter(eventId: string, error: string, now: string): Promise<void>;
  markUnhandled(eventId: string, now: string): Promise<void>;
}
