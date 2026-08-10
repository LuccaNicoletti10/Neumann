import type { OutboxRecord } from './types.js';
import type { OutboxStore } from './store/memory-outbox.js';

export type PublishHandler = (record: OutboxRecord) => Promise<void>;

export interface OutboxPublisherOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export class OutboxPublisher {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeNotify: (() => void) | null = null;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly keyLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly store: OutboxStore,
    private readonly handler: PublishHandler,
    private readonly options: OutboxPublisherOptions = {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribeNotify = this.store.onNotify(() => {
      void this.tick();
    });
    const interval = this.options.pollIntervalMs ?? 250;
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, interval);
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.unsubscribeNotify) {
      this.unsubscribeNotify();
      this.unsubscribeNotify = null;
    }
  }

  async tick(): Promise<void> {
    if (!this.running) return;
    const records = this.store.listUnpublished();
    for (const record of records) {
      await this.deliver(record);
    }
  }

  private async deliver(record: OutboxRecord): Promise<void> {
    const existing = this.inFlight.get(record.eventId);
    if (existing) {
      await existing;
      return;
    }

    const maxAttempts = this.options.maxAttempts ?? 10;
    if (record.attempts >= maxAttempts) return;

    const task = this.runDelivery(record);
    this.inFlight.set(record.eventId, task);
    try {
      await task;
    } finally {
      if (this.inFlight.get(record.eventId) === task) {
        this.inFlight.delete(record.eventId);
      }
    }
  }

  private async runDelivery(record: OutboxRecord): Promise<void> {
    await this.withKeyLock(record.key, async () => {
      const latest = this.store.listUnpublished().find((r) => r.eventId === record.eventId);
      if (!latest) return;
      try {
        await this.handler(latest);
        await this.store.markPublished(latest.eventId);
      } catch {
        await this.store.incrementAttempts(latest.eventId);
      }
    });
  }

  private async withKeyLock(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.keyLocks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.keyLocks.set(key, next);
    try {
      await next;
    } finally {
      if (this.keyLocks.get(key) === next) {
        this.keyLocks.delete(key);
      }
    }
  }
}
