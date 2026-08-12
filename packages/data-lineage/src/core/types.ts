/**
 * data-lineage — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateLineageStoreOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Subscriber de mudanças (US20150012477 — mínimo). */
  onChange?: (event: import('contracts').LineageChangeEvent) => void;
}
