/**
 * fair-query-scheduler — src/core/types.ts
 *
 * Implementa funcionalmente (de forma independente, sem copiar texto dos claims)
 * o componente da patente US 9.092.482 B2 referente às ESTRUTURAS DE DADOS do
 * escalonamento justo: o "job request" com estimativa de custo (número esperado
 * de resultados), a "sub-query task" paginada por keyset, o "job item" mantido
 * na fila de execução e os estados do ciclo de vida do job. Define ainda o
 * relógio injetável (Clock) que garante determinismo total (sem Date.now(),
 * setTimeout ou Math.random() na lógica).
 */

/** Linha retornada pelo DBMS simulado: chave numérica ordenada + valor. */
export interface Row {
  id: number;
  value: string;
}

/**
 * Relógio injetável. `now()` retorna o tempo corrente em ms e `advance(ms)`
 * avança o tempo (usado pelo DBMS simulado para representar a latência de
 * execução de cada sub-query task de forma determinística).
 */
export interface Clock {
  now(): number;
  advance(ms: number): void;
}

/** Relógio falso para testes e simulações determinísticas. */
export class FakeClock implements Clock {
  private t: number;
  constructor(startMs = 0) {
    this.t = startMs;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`FakeClock.advance: valor inválido: ${ms}`);
    }
    this.t += ms;
  }
}

/**
 * Relógio real (apenas para uso em produção/CLI). `advance` é no-op: a
 * latência simulada não bloqueia o relógio real.
 */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  advance(): void {
    /* no-op intencional */
  }
}

/**
 * Requisição de job submetida por um cliente: a consulta (nome da tabela/
 * coleção no DBMS simulado), a estimativa de custo (número esperado de
 * resultados) e parâmetros opcionais (ex.: nó preferido).
 */
export interface JobRequest {
  query: string;
  costEstimate: number;
  params?: Record<string, unknown>;
}

/** Estados do ciclo de vida de um job. */
export type JobState = 'queued' | 'running' | 'done' | 'cancelled';

/**
 * Sub-query task concreta gerada por divisão (split) por keyset/seek
 * pagination: executa `WHERE id > after ORDER BY id LIMIT limit`.
 * Na primeira task, `after` é indefinido (sem cláusula de seek).
 */
export interface SubQueryTask {
  jobId: string;
  seq: number;
  after?: number;
  limit: number;
}

/** Registro de uma execução de sub-query task (para auditoria e testes). */
export interface TaskExecution {
  seq: number;
  node: string;
  after?: number;
  limit: number;
  rowsReturned: number;
  startedAt: number;
  finishedAt: number;
}

/** Job de consulta gerenciado pelo scheduler. */
export interface QueryJob {
  id: string;
  request: JobRequest;
  /** Estimativa de custo efetivamente utilizada na decisão de threshold. */
  costEstimate: number;
  /** Verdadeiro se o job foi dividido em múltiplas sub-query tasks. */
  split: boolean;
  /** Tamanho do rate limiter (LIMIT) aplicado às sub-query tasks. */
  limit: number;
  state: JobState;
  /** Nó do DBMS atualmente atribuído ao job. */
  node: string;
  /** Instante (clock injetável) da submissão. */
  createdAt: number;
  /** Instante do primeiro resultado retornado, se já ocorreu. */
  firstResultAt?: number;
  /** Instante de conclusão (done) ou cancelamento (cancelled). */
  completedAt?: number;
  /** Linhas agregadas das execuções parciais, em ordem de chave. */
  rows: Row[];
  tasksExecuted: number;
  migrations: number;
  taskLog: TaskExecution[];
}

/**
 * Item mantido na fila de execução de jobs (round-robin). Guarda o job, o
 * próximo valor de seek (`nextAfter` — último valor retornado pela sub-task
 * anterior), o estado do item e o nó atribuído.
 */
export interface JobItem {
  job: QueryJob;
  /** Último valor retornado; a próxima sub-task usa `id > nextAfter`. */
  nextAfter?: number;
  /** Sequência da próxima sub-query task a ser gerada. */
  nextSeq: number;
  state: JobState;
  node: string;
}

/** Métricas de latência por job. */
export interface JobMetrics {
  jobId: string;
  costEstimate: number;
  state: JobState;
  /** Latência até o primeiro resultado (ms, relativo à submissão). */
  firstResultLatencyMs: number | null;
  /** Tempo total de conclusão (ms, relativo à submissão). */
  completionTimeMs: number | null;
  tasksExecuted: number;
  rowCount: number;
  migrations: number;
}

/** Resultado final entregue à promessa do job. */
export interface JobResult {
  jobId: string;
  state: JobState;
  rows: Row[];
  metrics: JobMetrics;
}
