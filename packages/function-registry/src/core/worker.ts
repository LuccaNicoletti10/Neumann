import type { FunctionRuntime } from 'contracts';

import { FunctionLeaseHeldError } from './errors.js';
import type { FunctionExecutionStore } from './execution-store.js';
import type { Clock } from 'object-platform';

const DEFAULT_BACKOFF_MS = [200, 500, 1_000, 2_000, 5_000] as const;

export interface CreateFunctionWorkerOptions {
  runtime: FunctionRuntime;
  executions: FunctionExecutionStore;
  clock: Clock;
  workerId: string;
  concurrency?: number;
  pollIntervalMs?: number;
  backoffMs?: readonly number[];
}

export interface FunctionWorker {
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

export function createFunctionWorker(opts: CreateFunctionWorkerOptions): FunctionWorker {
  const concurrency = opts.concurrency ?? 1;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const schedule = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let stopping = false;
  let inFlight = 0;

  async function drainOnce(): Promise<number> {
    let ran = 0;
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i += 1) {
      tasks.push(
        (async () => {
          const claimed = await opts.executions.claimNext(opts.workerId, opts.clock(), 15_000);
          if (!claimed) return;
          inFlight += 1;
          try {
            await opts.runtime.runOnce(claimed.executionId, opts.workerId);
            ran += 1;
          } catch (err) {
            if (err instanceof FunctionLeaseHeldError) return;
            throw err;
          } finally {
            inFlight -= 1;
          }
        })(),
      );
    }
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected' && !(result.reason instanceof FunctionLeaseHeldError)) {
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
          const idx = Math.min(emptyStreak - 1, schedule.length - 1);
          await sleep(schedule[idx] ?? pollIntervalMs, signal);
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
