/**
 * fair-query-scheduler — src/index.ts
 *
 * API pública do pacote: re-exporta os módulos que implementam funcionalmente
 * (de forma independente) os mecanismos da patente US 9.092.482 B2
 * ("Fair Scheduling for Mixed-Query Loads"): estimativa de custo, decisão por
 * threshold, divisão keyset/seek pagination, fila round-robin, cancelamento,
 * migração de nó e métricas de latência FCFS × fair.
 */

export * from './core/types.js';
export * from './core/dbms.js';
export * from './core/cost.js';
export * from './core/task-splitter.js';
export * from './core/job-queue.js';
export * from './core/scheduler.js';
export * from './core/compare.js';
export {
  createHandler,
  createDemoDeps,
  startServer,
  MAX_BODY,
} from './server/index.js';
export type { ServerDeps, StartedServer } from './server/index.js';
