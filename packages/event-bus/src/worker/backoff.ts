/**
 * event-bus — exponential backoff + jitter for outbox retries.
 * attempt 1 → 1s, 2 → 5s, 3 → 15s, 4 → 1m, 5 → 5m, 6+ → 15m
 * delay = base * random(0.8, 1.2)
 */

export const DEFAULT_BACKOFF_MS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000] as const;

export interface BackoffOptions {
  random?: () => number;
  schedule?: readonly number[];
}

export function computeBackoffMs(attempts: number, opts: BackoffOptions = {}): number {
  const schedule = opts.schedule ?? DEFAULT_BACKOFF_MS;
  const idx = Math.min(Math.max(attempts, 1) - 1, schedule.length - 1);
  const base = schedule[idx] ?? schedule[schedule.length - 1] ?? 900_000;
  const rand = opts.random ?? Math.random;
  const jitter = 0.8 + rand() * 0.4;
  return Math.round(base * jitter);
}
