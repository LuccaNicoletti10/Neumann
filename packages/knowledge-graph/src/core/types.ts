/**
 * knowledge-graph — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateKnowledgeGraphOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Se true, self-loops são rejeitados (default true). */
  forbidSelfLoops?: boolean;
}
