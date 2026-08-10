// bounded-fair-scheduler — utilitários de teste (não faz parte da API pública).
import { DatabaseManagementSystem, DatabaseNode } from '../src/core/dbms.js';
import { BoundedFairScheduler } from '../src/core/scheduler.js';
import type { SchedulerConfig } from '../src/core/scheduler.js';
import { generateRows, ManualClock } from '../src/core/types.js';
import type { Row } from '../src/core/types.js';

export interface MakeSchedulerOptions {
  rowCount?: number;
  maxQueueSize?: number;
  maxTaskSize?: number;
  nodeNames?: string[];
  baseMs?: number;
  perRowMs?: number;
}

export function makeScheduler(opts: MakeSchedulerOptions = {}): {
  scheduler: BoundedFairScheduler;
  clock: ManualClock;
  dbms: DatabaseManagementSystem;
  config: SchedulerConfig;
} {
  const rowCount = opts.rowCount ?? 1000;
  const nodeNames = opts.nodeNames ?? ['node-A', 'node-B'];
  const dbms = DatabaseManagementSystem.uniform(
    nodeNames,
    generateRows(rowCount),
    opts.baseMs ?? 5,
    opts.perRowMs ?? 1,
  );
  const clock = new ManualClock(0);
  const defaultNode = nodeNames[0];
  const config: SchedulerConfig = {
    maxQueueSize: opts.maxQueueSize ?? 10,
    maxTaskSize: opts.maxTaskSize ?? 50,
    clock,
    dbms,
    ...(defaultNode !== undefined ? { defaultNode } : {}),
  };
  return { scheduler: new BoundedFairScheduler(config), clock, dbms, config };
}

/** DBMS em que cada nó marca as linhas com seu prefixo (prova de migração). */
export function makeDistinctNodesDbms(
  rowCount: number,
  nodeNames: string[],
): DatabaseManagementSystem {
  const nodes = nodeNames.map(
    (name) =>
      new DatabaseNode(
        name,
        generateRows(rowCount, name).map((r): Row => ({ id: r.id, value: r.value })),
        5,
        1,
      ),
  );
  return new DatabaseManagementSystem(nodes);
}

export function ids(rows: Row[]): number[] {
  return rows.map((r) => r.id);
}