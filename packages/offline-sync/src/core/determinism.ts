/**
 * offline-sync — src/core/determinism.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export const DEFAULT_EPOCH = '2024-06-01T12:00:00.000Z';

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
