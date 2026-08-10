// bounded-fair-scheduler — agendador justo com fila de execução limitada.
// Implementa funcionalmente, de forma independente, os mecanismos da patente
// US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads"):
//  (a) submissão de QueryJob com costEstimate;
//  (b) round-robin com 1 sub-tarefa por dequeue e marcação de progresso
//      (sequência da última sub-tarefa completa + valor do último resultado);
//  (c) backpressure: waiting queue FIFO quando a execution queue está cheia,
//      com promoção somente quando um slot é liberado por conclusão/cancelamento;
//  (d) cancelamento de itens nas duas filas;
//  (e) migração de nó: gera um 2º query job baseado no 1º e o executa em nó B ≠ A;
//  (f) métricas de latência de 1º resultado e conclusão por job.
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original.

import { BoundedJobQueue } from './bounded-queue.js';
import type { QueueSnapshot } from './bounded-queue.js';
import type { DatabaseManagementSystem } from './dbms.js';
import { chooseTaskLimit, isChainExhausted, isEstimateReached, nextSubTask } from './task-splitter.js';
import type {
  AdmissionTarget,
  AdvanceableClock,
  JobMetrics,
  JobRecord,
  QueryJob,
} from './types.js';

export interface SchedulerConfig {
  maxQueueSize: number;
  /** Teto absoluto do rate limiter de cada sub-tarefa. */
  maxTaskSize: number;
  clock: AdvanceableClock;
  dbms: DatabaseManagementSystem;
  /** Nó padrão para jobs que não especificam `node`. */
  defaultNode?: string;
}

export interface SubmitResult {
  jobId: string;
  admitted: AdmissionTarget;
}

export interface MigrateResult {
  /** Id do 2º query job (derivado do 1º), enfileirado no nó de destino. */
  newJobId: string;
  admitted: AdmissionTarget;
  fromNode: string;
  toNode: string;
}

export interface SchedulerSummary {
  /** Quantas vezes jobs ficaram retidos na waiting queue (backpressure). */
  waitingQueueEnqueuedCount: number;
  /** Quantas vezes jobs foram promovidos da waiting para a execution queue. */
  promotedFromWaitingCount: number;
  completedCount: number;
  cancelledCount: number;
  migratedCount: number;
  queue: QueueSnapshot;
}

/** Snapshot serializável do estado completo (usado pela CLI e testes). */
export interface SchedulerSnapshot {
  nextSeq: number;
  clockNow: number;
  execution: string[];
  waiting: string[];
  records: JobRecord[];
  waitingQueueEnqueuedCount: number;
  promotedFromWaitingCount: number;
}

export class BoundedFairScheduler {
  private readonly config: SchedulerConfig;
  private readonly queue: BoundedJobQueue;
  private readonly records = new Map<string, JobRecord>();
  private nextSeq = 0;
  private waitingQueueEnqueuedCount = 0;
  private promotedFromWaitingCount = 0;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.queue = new BoundedJobQueue(config.maxQueueSize);
  }

  get clock(): AdvanceableClock {
    return this.config.clock;
  }

  /** Submete um QueryJob. Backpressure: cheia → waiting queue FIFO separada. */
  submit(job: QueryJob): SubmitResult {
    if (!Number.isInteger(job.costEstimate) || job.costEstimate < 1) {
      throw new Error('submit: costEstimate deve ser inteiro >= 1');
    }
    this.nextSeq += 1;
    const jobId = job.id ?? `job-${this.nextSeq}`;
    if (this.records.has(jobId)) throw new Error(`submit: jobId duplicado: ${jobId}`);
    const node = job.node ?? this.config.defaultNode ?? this.config.dbms.nodeNames()[0];
    if (node === undefined || !this.config.dbms.has(node)) {
      throw new Error(`submit: nó desconhecido: ${String(node)}`);
    }
    const now = this.config.clock.now();
    const record: JobRecord = {
      jobId,
      query: job.query,
      params: job.params ?? {},
      costEstimate: job.costEstimate,
      node,
      status: 'queued-execution',
      admittedTo: 'execution',
      subTaskSeqCompleted: 0,
      lastValue: null,
      rows: [],
      submittedAt: now,
      firstResultAt: null,
      completedAt: null,
      cancelledAt: null,
      waitingEnteredAt: null,
      promotedAt: null,
      migratedFrom: null,
      migratedTo: null,
      tasksExecuted: 0,
    };
    const admitted = this.queue.admit(record);
    record.admittedTo = admitted;
    if (admitted === 'waiting') {
      record.status = 'queued-waiting';
      record.waitingEnteredAt = now;
      this.waitingQueueEnqueuedCount += 1;
    }
    this.records.set(jobId, record);
    return { jobId, admitted };
  }

  /**
   * Executa EXATAMENTE um ciclo: dequeue da frente → próxima sub-tarefa keyset →
   * marca progresso → re-enfileira no fim (se houver mais) ou completa (liberando
   * o slot e promovendo o 1º da waiting queue). Retorna false se não há trabalho.
   */
  step(): boolean {
    const record = this.queue.dequeue();
    if (record === undefined) return false;
    record.status = 'running';

    const task = nextSubTask(
      {
        jobId: record.jobId,
        node: record.node,
        subTaskSeqCompleted: record.subTaskSeqCompleted,
        lastValue: record.lastValue,
        rowsCollected: record.rows.length,
      },
      record.costEstimate,
      this.config.maxTaskSize,
    );
    const rows = this.config.dbms.execute(
      record.node,
      { after: task.after, limit: task.limit },
      this.config.clock,
    );

    const now = this.config.clock.now();
    record.tasksExecuted += 1;
    if (rows.length > 0) {
      if (record.firstResultAt === null) record.firstResultAt = now;
      record.rows.push(...rows);
      const last = rows[rows.length - 1];
      if (last !== undefined) record.lastValue = last.id;
    }
    // Marcação de progresso: sequência da última sub-tarefa completamente executada.
    record.subTaskSeqCompleted = task.seq;

    if (isChainExhausted(rows.length, task.limit) || isEstimateReached(record.rows.length, record.costEstimate)) {
      // Não há mais sub-tarefas: completa e libera o slot.
      record.status = 'completed';
      record.completedAt = now;
      const promoted = this.queue.complete(record.jobId);
      this.markPromoted(promoted);
    } else {
      // Round-robin: volta para o FIM da execution queue (NUNCA para a waiting).
      record.status = 'queued-execution';
      this.queue.reenqueue(record);
    }
    return true;
  }

  /** Executa ciclos até a execution queue esvaziar (waiting também, via promoções). */
  runUntilIdle(): number {
    let steps = 0;
    while (this.step()) steps += 1;
    return steps;
  }

  /**
   * Cancelamento: remove o job item da execution queue (liberando slot → promove
   * o 1º da waiting) ou da waiting queue. Retorna false se o job não está enfileirado.
   */
  cancel(jobId: string): boolean {
    const removal = this.queue.remove(jobId);
    if (removal === null) return false;
    removal.record.status = 'cancelled';
    removal.record.cancelledAt = this.config.clock.now();
    this.markPromoted(removal.promoted);
    return true;
  }

  /**
   * Migração de nó: remove o job item (cujas sub-tarefas executavam no nó atual),
   * gera um 2º query job baseado no 1º — preservando progresso (lastValue,
   * subTaskSeqCompleted, resultados) — e o enfileira para executar sua 1ª
   * sub-tarefa no nó de destino (B ≠ A). Retorna null se o job não está enfileirado.
   */
  migrate(jobId: string, toNode: string): MigrateResult | null {
    if (!this.config.dbms.has(toNode)) {
      throw new Error(`migrate: nó desconhecido: ${toNode}`);
    }
    const removal = this.queue.remove(jobId);
    if (removal === null) return null;
    const source = removal.record;
    if (source.node === toNode) {
      throw new Error(`migrate: nó de destino igual ao atual (${toNode})`);
    }
    source.status = 'migrated';
    source.migratedTo = toNode;
    this.markPromoted(removal.promoted);

    this.nextSeq += 1;
    const newJobId = `${jobId}-mig${this.nextSeq}`;
    const now = this.config.clock.now();
    const derived: JobRecord = {
      jobId: newJobId,
      query: source.query,
      params: { ...source.params },
      costEstimate: source.costEstimate,
      node: toNode,
      status: 'queued-execution',
      admittedTo: 'execution',
      subTaskSeqCompleted: source.subTaskSeqCompleted,
      lastValue: source.lastValue,
      rows: [...source.rows],
      submittedAt: source.submittedAt,
      firstResultAt: source.firstResultAt,
      completedAt: null,
      cancelledAt: null,
      waitingEnteredAt: null,
      promotedAt: null,
      migratedFrom: jobId,
      migratedTo: null,
      tasksExecuted: source.tasksExecuted,
    };
    const admitted = this.queue.admit(derived);
    derived.admittedTo = admitted;
    if (admitted === 'waiting') {
      derived.status = 'queued-waiting';
      derived.waitingEnteredAt = now;
      this.waitingQueueEnqueuedCount += 1;
    }
    this.records.set(newJobId, derived);
    return { newJobId, admitted, fromNode: source.node, toNode };
  }

  private markPromoted(promoted: JobRecord | null): void {
    if (promoted === null) return;
    promoted.status = 'queued-execution';
    promoted.promotedAt = this.config.clock.now();
    this.promotedFromWaitingCount += 1;
  }

  /** Rate limiter que seria aplicado à próxima sub-tarefa do job (introspecção). */
  previewTaskLimit(jobId: string): number {
    const rec = this.requireRecord(jobId);
    return chooseTaskLimit(rec.costEstimate, this.config.maxTaskSize);
  }

  getRecord(jobId: string): JobRecord | undefined {
    return this.records.get(jobId);
  }

  private requireRecord(jobId: string): JobRecord {
    const rec = this.records.get(jobId);
    if (!rec) throw new Error(`Job desconhecido: ${jobId}`);
    return rec;
  }

  /** Métricas públicas de um job (latência de 1º resultado e de conclusão). */
  getMetrics(jobId: string): JobMetrics | undefined {
    const rec = this.records.get(jobId);
    if (!rec) return undefined;
    return {
      jobId: rec.jobId,
      status: rec.status,
      admittedTo: rec.admittedTo,
      node: rec.node,
      costEstimate: rec.costEstimate,
      rowsReturned: rec.rows.length,
      tasksExecuted: rec.tasksExecuted,
      submittedAt: rec.submittedAt,
      firstResultLatencyMs:
        rec.firstResultAt === null ? null : rec.firstResultAt - rec.submittedAt,
      completionLatencyMs:
        rec.completedAt === null ? null : rec.completedAt - rec.submittedAt,
      waitingTimeMs:
        rec.waitingEnteredAt === null
          ? null
          : (rec.promotedAt ?? rec.cancelledAt ?? this.config.clock.now()) -
            rec.waitingEnteredAt,
      migratedFrom: rec.migratedFrom,
      migratedTo: rec.migratedTo,
    };
  }

  listMetrics(): JobMetrics[] {
    return [...this.records.values()]
      .map((r) => this.getMetrics(r.jobId))
      .filter((m): m is JobMetrics => m !== undefined);
  }

  queueSnapshot(): QueueSnapshot {
    return this.queue.snapshot();
  }

  summary(): SchedulerSummary {
    const all = [...this.records.values()];
    return {
      waitingQueueEnqueuedCount: this.waitingQueueEnqueuedCount,
      promotedFromWaitingCount: this.promotedFromWaitingCount,
      completedCount: all.filter((r) => r.status === 'completed').length,
      cancelledCount: all.filter((r) => r.status === 'cancelled').length,
      migratedCount: all.filter((r) => r.status === 'migrated').length,
      queue: this.queue.snapshot(),
    };
  }

  /** Serializa o estado completo (Clock deve ser ManualClock). */
  snapshotState(): SchedulerSnapshot {
    const now = this.config.clock.now();
    return {
      nextSeq: this.nextSeq,
      clockNow: now,
      execution: this.queue.executionIds(),
      waiting: this.queue.waitingIds(),
      records: [...this.records.values()].map((r) => ({
        ...r,
        params: { ...r.params },
        rows: r.rows.map((row) => ({ ...row })),
      })),
      waitingQueueEnqueuedCount: this.waitingQueueEnqueuedCount,
      promotedFromWaitingCount: this.promotedFromWaitingCount,
    };
  }

  /** Restaura um agendador a partir de um snapshot (config nova, clock no instante salvo). */
  static restore(snapshot: SchedulerSnapshot, config: SchedulerConfig): BoundedFairScheduler {
    const scheduler = new BoundedFairScheduler(config);
    scheduler.nextSeq = snapshot.nextSeq;
    for (const rec of snapshot.records) scheduler.records.set(rec.jobId, rec);
    const byId = (id: string): JobRecord => {
      const rec = scheduler.records.get(id);
      if (!rec) throw new Error(`restore: registro ausente para ${id}`);
      return rec;
    };
    scheduler.queue.restore(snapshot.execution.map(byId), snapshot.waiting.map(byId));
    scheduler.waitingQueueEnqueuedCount = snapshot.waitingQueueEnqueuedCount;
    scheduler.promotedFromWaitingCount = snapshot.promotedFromWaitingCount;
    return scheduler;
  }
}