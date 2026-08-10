import type { CanonicalEvent, OutboxRecord } from './types.js';
import { toCanonicalEvent } from './types.js';

export type EventHandler = (event: CanonicalEvent) => Promise<void> | void;

export class IdempotentConsumer {
  private readonly seen = new Set<string>();

  hasSeen(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  markSeen(eventId: string): void {
    this.seen.add(eventId);
  }

  clear(): void {
    this.seen.clear();
  }

  async handle(record: OutboxRecord, fn: EventHandler): Promise<boolean> {
    if (this.seen.has(record.eventId)) {
      return false;
    }
    const event = toCanonicalEvent(record);
    await fn(event);
    this.seen.add(record.eventId);
    return true;
  }
}
