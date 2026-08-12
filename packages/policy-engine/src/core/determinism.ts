/**
 * policy-engine — src/core/determinism.ts
 */

import { randomBytes } from 'node:crypto';

import type { Clock, IdGenerator, SaltGenerator } from './types.js';

export const DEFAULT_EPOCH = '2024-01-01T00:00:00.000Z';

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

export function createIdGenerator(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix: string): string => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

export function createDeterministicSalt(): SaltGenerator {
  let n = 0;
  return (): string => {
    n += 1;
    return `salt-${n}`;
  };
}

export function createRandomSalt(): SaltGenerator {
  return (): string => randomBytes(16).toString('hex');
}
