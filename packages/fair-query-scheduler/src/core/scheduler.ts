/**
 * fair-query-scheduler — src/core/scheduler.ts
 *
 * Implementa funcionalmente o componente central da patente US 9.092.482 B2:
 * o ESCALONADOR JUSTO (fair scheduler) para cargas mistas de consultas.
 *
 * - submit(request) cria o job, decide por threshold (dividir ou não) e
 *   enfileira o job item no FIM da fila de execução;
 * - step() executa UM ciclo round-robin: dequeue da FRENTE → executa a
 *   PRÓXIMA sub-query task do job no DBMS (no nó atribuído) → se houver mais
 *   sub-tasks pendentes, determina o último valor retornado e re-enfileira o
 *   item no FIM; se não houver, o job completa e sua promessa é resolvida;
 * - runUntilIdle() repete step() até esvaziar a fila (sem timers reais —
 *   o tempo só avança pela latência simulada do DBMS via Clock injetável);
 * - cancel(jobId) remove o job item da fila e marca o job como cancelado;
 * - migrate(jobId, toNode) implementa a MIGRAÇÃO DE NÓ: em t1 remove o job
 *   item da fila (mesmo com sub-task sua em execução no nó A); em t2 > t1
 *   gera um SEGUNDO query job (continuação) baseado no primeiro — retomando
 *   do último valor retornado — e o enfileira com a próxima sub-task
 *   atribuída a um nó B ≠ A;
 * - agrega resultados parciais em ordem de chave e expõe métricas de
 *   latência por job (tempo até o 1º resultado e tempo de conclusão).
 */

import { CostEstimator } from './cost.js';
import type { DatabaseManagementSystem } from './dbms.js';
import { JobExecutionQueue } from './job-queue.js';
import { SubQueryTaskIterator, shouldSplit, taskLimit } from './task-splitter.js';
import type {
  Clock,
  JobItem,
  JobMetrics,
  JobRequest,
  JobResult,
  QueryJob,
} from './types.js';

export interface FairSchedulerConfig {
  dbms: DatabaseManagementSystem;
  clock: Clock;
  /** Custo-limiar: acima dele o job é dividido em sub-query tasks. */
  thresholdCost: number;
  costEstimator?: CostEstimator;
  /** Nó padrão para novos jobs (default: nó padrão do DBMS). */
  defaultNode?: string;
}

interface Waiter {
  promise: Promise<JobResult>;
  resolve: (r: JobResult) => void;
}

export class FairScheduler {
  private readonly dbms: DatabaseManagementSystem;
  private readonly clock: Clock;
  private readonly thresholdCost: number;
  private readonly estimator: CostEstimator;
  private readonly defaultNode: string;

  private readonly queue = new JobExecutionQueue();
  private readonly jobs = new Map<string, QueryJob>();
  private readonly iterators = new Map<string, SubQueryTaskIterator>();
  private readonly waiters = new Map<string, Waiter>();
  private idSeq = 0;

  constructor(config: FairSchedulerConfig) {
    const t = config.thresholdCost;
    const valid = t === Number.POSITIVE_INFINITY || (Number.isInteger(t) && t >= 1);
    if (!valid) {
      throw new Error(`FairScheduler: thresholdCost inválido (${t})`);
    }
    this.dbms = config.dbms;
    this.clock = config.clock;
    this.thresholdCost = config.thresholdCost;
    this.estimator = config.costEstimator ?? new CostEstimator(this.dbms);
    this.defaultNode = config.defaultNode ?? this.dbms.defaultNode;
  }

  /** Submete um job request; retorna o jobId. */
  submit(request: JobRequest): string {
    const costEstimate = this.estimator.estimate(request);
    const split = shouldSplit(costEstimate, this.thresholdCost);
    const limit = taskLimit(costEstimate, this.thresholdCost);
    const nodeParam = request.params?.['node'];
    const node = typeof nodeParam === 'string' && this.dbms.hasNode(nodeParam)
      ? nodeParam
      : this.defaultNode;

    this.idSeq += 1;
    const id = `job-${this.idSeq}`;
    const job: QueryJob = {
      id,
      request,
      costEstimate,
      split,
      limit,
      state: 'queued',
      node,
      createdAt: this.clock.now(),
      rows: [],
      tasksExecuted: 0,
      migrations: 0,
      taskLog: [],
    };
    this.jobs.set(id, job);
    this.iterators.set(id, new SubQueryTaskIterator(id, limit));
    this.enqueueItem(job, undefined, 0);

    let resolveFn: (r: JobResult) => void = () => undefined;
    const promise = new Promise<JobResult>((res) => {
      resolveFn = res;
    });
    this.waiters.set(id, { promise, resolve: resolveFn });
    return id;
  }

  /** Promessa do resultado do job (resolve em done ou cancelled). */
  result(jobId: string): Promise<JobResult> {
    const w = this.waiters.get(jobId);
    if (!w) return Promise.reject(new Error(`FairScheduler: job "${jobId}" desconhecido`));
    return w.promise;
  }

  /** Snapshot somente-leitura do job (para inspeção/HTTP). */
  getJob(jobId: string): QueryJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(): QueryJob[] {
    return [...this.jobs.values()];
  }

  get queueSize(): number {
    return this.queue.size;
  }

  /** Métricas de latência de todos os jobs, em ordem de submissão. */
  metrics(): JobMetrics[] {
    return [...this.jobs.values()].map((j) => FairScheduler.metricsOf(j));
  }

  metricsOf(jobId: string): JobMetrics | undefined {
    const j = this.jobs.get(jobId);
    return j ? FairScheduler.metricsOf(j) : undefined;
  }

  private static metricsOf(j: QueryJob): JobMetrics {
    return {
      jobId: j.id,
      costEstimate: j.costEstimate,
      state: j.state,
      firstResultLatencyMs: j.firstResultAt === undefined ? null : j.firstResultAt - j.createdAt,
      completionTimeMs: j.completedAt === undefined ? null : j.completedAt - j.createdAt,
      tasksExecuted: j.tasksExecuted,
      rowCount: j.rows.length,
      migrations: j.migrations,
    };
  }

  private enqueueItem(job: QueryJob, nextAfter: number | undefined, nextSeq: number): void {
    const item: JobItem = { job, state: 'queued', node: job.node, nextSeq };
    if (nextAfter !== undefined) item.nextAfter = nextAfter;
    this.queue.enqueue(item);
  }

  /**
   * Executa UM ciclo do loop round-robin. Retorna true se havia trabalho
   * (um job item foi desenfileirado e processado), false se a fila está vazia.
   */
  step(): boolean {
    for (;;) {
      const item = this.queue.dequeue();
      if (!item) return false;
      const job = item.job;
      if (job.state === 'cancelled') continue; // item órfão: descarta

      const iterator = this.iterators.get(job.id);
      if (!iterator) throw new Error(`FairScheduler: iterador ausente para ${job.id}`);
      const task = iterator.peek();
      if (!task) {
        this.finish(job);
        continue;
      }

      job.state = 'running';
      item.state = 'running';
      const startedAt = this.clock.now();
      const rows = this.dbms.node(item.node).execute(job.request.query, task, this.clock);
      const finishedAt = this.clock.now();

      job.rows.push(...rows);
      job.tasksExecuted += 1;
      job.taskLog.push({
        seq: task.seq,
        node: item.node,
        limit: task.limit,
        rowsReturned: rows.length,
        startedAt,
        finishedAt,
        ...(task.after !== undefined ? { after: task.after } : {}),
      });
      if (job.firstResultAt === undefined && rows.length > 0) {
        job.firstResultAt = finishedAt;
      }

      iterator.advance(rows);
      if (iterator.done) {
        this.finish(job);
      } else {
        // Determina o último valor retornado e re-enfileira o item no FIM.
        const last = rows.at(-1);
        const nextAfter = last ? last.id : item.nextAfter;
        job.state = 'queued';
        job.node = item.node;
        this.enqueueItem(job, nextAfter, job.tasksExecuted);
      }
      return true;
    }
  }

  /**
   * Executa ciclos até a fila esvaziar e aguarda a resolução das promessas
   * de todos os jobs conhecidos (done ou cancelled). Não usa timers.
   */
  async runUntilIdle(): Promise<void> {
    while (this.step()) {
      /* laço dirigido pelo Clock injetável */
    }
    await Promise.allSettled([...this.waiters.values()].map((w) => w.promise));
  }

  /**
   * Cancelamento: remove o(s) job item(s) do job da fila e marca o job como
   * cancelado. Uma sub-task eventualmente em voo NÃO é re-enfileirada, pois o
   * estado 'cancelled' é verificado antes de qualquer re-enfileiramento.
   * Retorna true se o job existia e ainda não estava finalizado.
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.state === 'done' || job.state === 'cancelled') return false;
    this.queue.remove(jobId);
    job.state = 'cancelled';
    job.completedAt = this.clock.now();
    this.settle(job);
    return true;
  }

  /**
   * Migração de nó (requeue em nó diferente):
   *  - t1: remove o job item do job da fila (mesmo que uma sub-task sua
   *    esteja/tenha estado em execução no nó A);
   *  - t2 > t1: gera um SEGUNDO query job (continuação) baseado no primeiro,
   *    retomando do último valor retornado (sem duplicar nem perder linhas),
   *    e o enfileira com a próxima sub-task atribuída ao nó `toNode` (B ≠ A).
   *
   * O jobId e a promessa do job original são preservados: o resultado final
   * agrega as linhas das execuções em A e em B.
   */
  migrate(jobId: string, toNode: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.state === 'done' || job.state === 'cancelled') return false;
    if (!this.dbms.hasNode(toNode)) {
      throw new Error(`FairScheduler.migrate: nó "${toNode}" não existe no DBMS`);
    }

    // t1: remove o job item original da fila.
    this.queue.remove(jobId);

    // t2: gera a continuação (segundo query job baseado no primeiro).
    const lastRow = job.rows.at(-1);
    const nextAfter = lastRow ? lastRow.id : undefined;
    const iterator = new SubQueryTaskIterator(job.id, job.limit, job.tasksExecuted, nextAfter);
    this.iterators.set(job.id, iterator);
    job.node = toNode;
    job.migrations += 1;
    job.state = 'queued';
    this.enqueueItem(job, nextAfter, job.tasksExecuted);
    return true;
  }

  private finish(job: QueryJob): void {
    job.state = 'done';
    job.completedAt = this.clock.now();
    this.settle(job);
  }

  private settle(job: QueryJob): void {
    const w = this.waiters.get(job.id);
    if (!w) return;
    w.resolve({
      jobId: job.id,
      state: job.state,
      rows: [...job.rows],
      metrics: FairScheduler.metricsOf(job),
    });
  }
}
