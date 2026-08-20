/**
 * object-platform — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateObjectPlatformOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /**
   * Required authorize. Tests inject createAllowAllTestPolicy().authorizeFn.
   * No implicit allow-all.
   */
  authorize: import('contracts').AuthorizeFn;
  /**
   * Canonical stores. Omitted → memory adapters (Maps live only inside those adapters).
   * Async (PG) stores fail closed; use ProjectionWriter.
   */
  objects?: import('contracts').ObjectRepository;
  links?: import('contracts').LinkRepository;
  history?: import('./object-history-store.js').ObjectHistoryStore;
  /** Namespace for repository identity. Default `platform`. */
  ontologyId?: string;
}
