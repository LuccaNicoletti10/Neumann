/**
 * ingestion-runtime — operational worker. Calls runOnce; never repositories.
 */

import type { IngestionRuntime } from 'contracts';

import { IngestionLeaseHeldError } from './errors.js';
import type { IngestionStore } from './ingestion-store.js';
import type { Clock } from './runtime.js';

const DEFAULT_BACKOFF_MS = [200, 500, 1_000, 2_000, 5_000] as const;

export interface CreateIngestionWorkerOptions {
  runtime: IngestionRuntime;
  store: IngestionStore;
  clock: Clock;
  concurrency?: number;
  pollIntervalMs?: number;
  backoffMs?: readonly number[];
}

export interface IngestionWorker {
  drainOnce(): Promise<number>;
  run(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function backoffMs(emptyStreak: number, schedule: readonly number[]): number {
  const idx = Math.min(Math.max(emptyStreak, 1) - 1, schedule.length - 1);
  return schedule[idx] ?? schedule[schedule.length - 1] ?? 5_000;
}

export function createIngestionWorker(opts: CreateIngestionWorkerOptions): IngestionWorker {
  const concurrency = opts.concurrency ?? 1;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const schedule = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let stopping = false;
  let inFlight = 0;

  async function drainOnce(): Promise<number> {
    const now = opts.clock();
    await opts.store.purgeExpiredNonces(now);
    const ids = await opts.store.listRunnable(concurrency, now);
    let ran = 0;
    const tasks = ids.map(async (id) => {
      inFlight += 1;
      try {
        await opts.runtime.runOnce(id);
        ran += 1;
      } catch (err) {
        if (err instanceof IngestionLeaseHeldError) return;
        throw err;
      } finally {
        inFlight -= 1;
      }
    });
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected' && !(result.reason instanceof IngestionLeaseHeldError)) {
        throw result.reason;
      }
    }
    return ran;
  }

  async function waitInFlight(): Promise<void> {
    while (inFlight > 0) {
      await sleep(10, new AbortController().signal);
    }
  }

  return {
    drainOnce,
    async run(signal) {
      stopping = false;
      let emptyStreak = 0;
      while (!signal.aborted && !stopping) {
        const n = await drainOnce();
        if (signal.aborted || stopping) break;
        if (n === 0) {
          emptyStreak += 1;
          await sleep(Math.min(backoffMs(emptyStreak, schedule), pollIntervalMs * 20), signal);
        } else {
          emptyStreak = 0;
          await sleep(pollIntervalMs, signal);
        }
      }
      await waitInFlight();
    },
    async stop() {
      stopping = true;
      await waitInFlight();
    },
  };
}
