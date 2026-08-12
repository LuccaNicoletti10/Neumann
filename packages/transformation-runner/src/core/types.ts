/**
 * transformation-runner — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export type Row = Record<string, unknown>;

export interface NamedTable {
  name: string;
  columns: string[];
  rows: Row[];
}

export interface CreateRunnerOptions {
  clock?: Clock;
  nextId?: IdGenerator;
}
