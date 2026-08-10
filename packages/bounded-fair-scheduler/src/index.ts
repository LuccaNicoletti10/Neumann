// bounded-fair-scheduler — ponto de entrada da biblioteca (re-exports públicos).
// Pacote que implementa funcionalmente, de forma independente, os mecanismos da
// patente US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads"):
// divisão de jobs por costEstimate, keyset chaining com rate limiter, fila de
// execução bounded com waiting queue (backpressure), round-robin com marcação de
// progresso, cancelamento, migração de nó, métricas e comparador vs FCFS.
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original.

export type { Clock, Row, QueryJob, SubQueryTask, JobStatus, AdmissionTarget, JobRecord, JobMetrics } from './core/types.js';
export { ManualClock, generateRows } from './core/types.js';

export type { NodeTaskRequest } from './core/dbms.js';
export { DatabaseNode, DatabaseManagementSystem } from './core/dbms.js';

export type { SplitterState } from './core/task-splitter.js';
export { chooseTaskLimit, nextSubTask, isChainExhausted } from './core/task-splitter.js';

export type { QueueSnapshot, QueueSnapshotEntry, RemovalLocation, RemovalResult } from './core/bounded-queue.js';
export { BoundedJobQueue } from './core/bounded-queue.js';

export type { SchedulerConfig, SubmitResult, MigrateResult, SchedulerSummary, SchedulerSnapshot } from './core/scheduler.js';
export { BoundedFairScheduler } from './core/scheduler.js';

export type { ComparisonConfig, ComparisonReport, ComparisonJobRow, LowCostComparison, PolicyLatencies } from './core/compare.js';
export { runComparison } from './core/compare.js';

export type { HttpServerOptions, StartedServer } from './server/index.js';
export { createSchedulerServer, startServer, MAX_BODY } from './server/index.js';