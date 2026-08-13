export type OutboxStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'RETRYING'
  | 'DELIVERED'
  | 'DEAD_LETTER'
  | 'UNHANDLED';

export interface OutboxEventRow {
  eventId: string;
  topic: string;
  orderingKey: string;
  payload: Record<string, unknown>;
  principal: string;
  tenantId: string;
  traceId: string;
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  nextAttemptAt?: string;
  lastError?: string;
  lockedBy?: string;
  leaseUntil?: string;
}

export type OutboxHandler = (event: OutboxEventRow) => Promise<void>;
