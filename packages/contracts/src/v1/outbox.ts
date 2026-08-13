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
