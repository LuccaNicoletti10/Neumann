/**
 * action-engine — src/core/memory-outbox.ts
 * In-memory OutboxRepository for tests (not the event-bus publisher store).
 */

import type { OutboxInsertInput, OutboxRepository } from 'contracts';

export function createMemoryOutboxRepository(): OutboxRepository & {
  records: OutboxInsertInput[];
} {
  const records: OutboxInsertInput[] = [];
  return {
    records,
    async insert(input) {
      records.push({ ...input });
    },
  };
}
