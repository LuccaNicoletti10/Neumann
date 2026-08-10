import { randomUUID } from 'node:crypto';
import type { Clock } from '../types.js';
import { FakeClock } from '../types.js';

export interface Job<T = Record<string, unknown>> {
  id: string;
  name: string;
  payload: T;
  priority: number;
  fairKey: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface JobQueue {
  enqueue<T>(job: {
    name: string;
    payload: T;
    priority?: number;
    fairKey?: string;
    maxAttempts?: number;
  }): string;
  dequeue(): Job | null;
  complete(jobId: string): void;
  fail(jobId: string, error?: Error): void;
  size(): number;
  get(jobId: string): Job | undefined;
  listPending(): Job[];
}

export interface InMemoryJobQueueOptions {
  clock?: Clock;
  baseBackoffMs?: number;
}

export class InMemoryJobQueue implements JobQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly clock: Clock;
  private readonly baseBackoffMs: number;
  private readonly rrCursor = new Map<number, number>();

  constructor(options: InMemoryJobQueueOptions = {}) {
    this.clock = options.clock ?? new FakeClock();
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
  }

  enqueue<T>(input: {
    name: string;
    payload: T;
    priority?: number;
    fairKey?: string;
    maxAttempts?: number;
  }): string {
    const id = randomUUID();
    const job: Job<T> = {
      id,
      name: input.name,
      payload: input.payload,
      priority: input.priority ?? 0,
      fairKey: input.fairKey ?? input.name,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: this.clock.now(),
      status: 'pending',
    };
    this.jobs.set(id, job as Job);
    return id;
  }

  dequeue(): Job | null {
    const now = this.clock.now();
    const ready = [...this.jobs.values()].filter(
      (j) => j.status === 'pending' && j.nextRunAt <= now,
    );
    if (ready.length === 0) return null;

    const byPriority = new Map<number, Job[]>();
    for (const job of ready) {
      const list = byPriority.get(job.priority) ?? [];
      list.push(job);
      byPriority.set(job.priority, list);
    }

    const priorities = [...byPriority.keys()].sort((a, b) => b - a);
    for (const priority of priorities) {
      const group = byPriority.get(priority)!;
      const fairBuckets = new Map<string, Job[]>();
      for (const job of group) {
        const bucket = fairBuckets.get(job.fairKey) ?? [];
        bucket.push(job);
        fairBuckets.set(job.fairKey, bucket);
      }
      const keys = [...fairBuckets.keys()].sort();
      if (keys.length === 0) continue;

      const cursor = this.rrCursor.get(priority) ?? 0;
      const key = keys[cursor % keys.length]!;
      this.rrCursor.set(priority, cursor + 1);

      const bucket = fairBuckets.get(key)!;
      bucket.sort((a, b) => a.nextRunAt - b.nextRunAt);
      const picked = bucket[0]!;
      picked.status = 'processing';
      return picked;
    }

    return null;
  }

  complete(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job not found: ${jobId}`);
    job.status = 'completed';
  }

  fail(jobId: string, _error?: Error): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job not found: ${jobId}`);
    job.attempts += 1;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      return;
    }
    const backoff = this.baseBackoffMs * 2 ** (job.attempts - 1);
    job.nextRunAt = this.clock.now() + backoff;
    job.status = 'pending';
  }

  size(): number {
    return [...this.jobs.values()].filter((j) => j.status === 'pending' || j.status === 'processing')
      .length;
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  listPending(): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === 'pending');
  }

  /** Reset in-flight jobs after a worker crash so they can be retried. */
  recover(): number {
    let recovered = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'processing') {
        job.status = 'pending';
        recovered += 1;
      }
    }
    return recovered;
  }

  async runWorker(
    handler: (job: Job) => Promise<void>,
    options: { maxJobs?: number } = {},
  ): Promise<number> {
    let processed = 0;
    const limit = options.maxJobs ?? Infinity;
    while (processed < limit) {
      const job = this.dequeue();
      if (!job) break;
      try {
        await handler(job);
        this.complete(job.id);
      } catch (err) {
        this.fail(job.id, err instanceof Error ? err : new Error(String(err)));
      }
      processed += 1;
    }
    return processed;
  }

  tick(handler: (job: Job) => Promise<void>): Promise<boolean> {
    const job = this.dequeue();
    if (!job) return Promise.resolve(false);
    return handler(job)
      .then(() => {
        this.complete(job.id);
        return true;
      })
      .catch((err) => {
        this.fail(job.id, err instanceof Error ? err : new Error(String(err)));
        return true;
      });
  }
}
