/**
 * entity-resolution — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateEntityResolverOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Número de bins do Bloom/hash (US20140280252). Default: auto pelo corpus. */
  bloomBins?: number;
}
