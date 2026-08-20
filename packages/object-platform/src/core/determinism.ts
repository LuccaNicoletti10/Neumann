/**
 * object-platform — src/core/determinism.ts
 * Deterministic providers for tests; production-safe providers for runtime.
 */

import { randomUUID } from 'node:crypto';

import type { Clock, IdGenerator } from './types.js';

export const DEFAULT_EPOCH = '2024-01-01T00:00:00.000Z';

/** Test-only: monotonic deterministic clock. */
export function createDeterministicClock(start: string = DEFAULT_EPOCH): Clock {
  const base = Date.parse(start);
  if (!Number.isFinite(base)) throw new Error(`instante inválido: ${start}`);
  let tick = 0;
  return (): string => {
    const instant = new Date(base + tick * 1000);
    tick += 1;
    return instant.toISOString();
  };
}

/** Test-only: sequential ids (`prefix-1`, `prefix-2`, …). Never use in production. */
export function createIdGenerator(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix: string): string => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

/**
 * Production clock. Monotonic per instance so two kernel events never share
 * an asOf instant; history.asOf would otherwise pick the later version.
 */
export function createSystemClock(): Clock {
  let lastMs = 0;
  return () => {
    let ms = Date.now();
    if (ms <= lastMs) ms = lastMs + 1;
    lastMs = ms;
    return new Date(ms).toISOString();
  };
}

/** Production collision-safe IDs (UUID v4). Prefix is informational only. */
export function createUuidIdGenerator(): IdGenerator {
  return (prefix: string): string => `${prefix}_${randomUUID()}`;
}
