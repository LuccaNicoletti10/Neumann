/**
 * knowledge-graph — src/core/types.ts
 */

import type { LinkRepository, ObjectRepository } from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateKnowledgeGraphOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Se true, self-loops são rejeitados (default true). */
  forbidSelfLoops?: boolean;
  /**
   * Canonical stores. Omitted → memory adapters (Maps live only inside those adapters).
   * Async (PG) stores fail closed on this sync facade.
   */
  objects?: ObjectRepository;
  links?: LinkRepository;
  /** Namespace for repository identity. Default `graph`. */
  ontologyId?: string;
  /** Seed known object types so listObjects() can walk injected repos without prior upsert. */
  objectTypeIds?: readonly string[];
}
