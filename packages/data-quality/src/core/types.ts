/**
 * data-quality — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export type Row = Record<string, unknown>;

export interface NamedDataset {
  id: string;
  name: string;
  version: number;
  columns: string[];
  rows: Row[];
  /** Instant da última atualização (ISO) — freshness. */
  updatedAt: string;
  /** Snapshot anterior de distribuição (drift). */
  previousDistribution?: Record<string, number>;
}

export interface CreateQualityEngineOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Agora lógico para freshness (default: clock()). */
  now?: string;
}
