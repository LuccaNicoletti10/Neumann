/**
 * delta-storage — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface DeltaTreeOptions {
  /** Fanout N: combined L1 a cada N updates (default 10). */
  fanout?: number;
  /** Níveis máximos de compactação (default 3 → N, N², N³). */
  maxLevel?: number;
  clock?: Clock;
  nextId?: IdGenerator;
}

export class DeltaCorruptError extends Error {
  constructor(
    message: string,
    readonly deltaId: string,
  ) {
    super(message);
    this.name = 'DeltaCorruptError';
  }
}
