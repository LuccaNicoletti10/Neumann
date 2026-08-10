// bounded-fair-scheduler — tipos fundamentais do agendador.
// Implementa funcionalmente, de forma independente, os componentes "job de consulta com
// estimativa de custo" e "item de job com marcação de progresso" descritos na patente
// US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads", continuação).
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original dos mecanismos.

/** Relógio injetável: única fonte de tempo do sistema (determinismo total). */
export interface Clock {
  now(): number;
}

/**
 * Relógio que pode ser avançado pela latência simulada do DBMS
 * (o scheduler e o DBMS exigem esta variante; FakeClock/ManualClock a implementam).
 */
export interface AdvanceableClock extends Clock {
  advance(ms: number): void;
}

/** Relógio manual: avança somente via advance() (usado pela latência simulada do DBMS). */
export class ManualClock implements AdvanceableClock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    if (ms < 0) throw new Error('ManualClock.advance: ms negativo');
    this.t += ms;
  }
}

/** Linha de resultado de uma consulta (ordenada por id na fonte de dados). */
export interface Row {
  id: number;
  value: string;
}

/**
 * Job de consulta submetido pelo cliente.
 * costEstimate = número esperado de resultados (dirige a divisão em sub-tarefas).
 */
export interface QueryJob {
  /** Texto da consulta (simbolico neste simulador). */
  query: string;
  /** Número esperado de resultados. */
  costEstimate: number;
  /** Parâmetros opcionais da consulta. */
  params?: Record<string, unknown>;
  /** Nó preferido do DBMS multi-nó (opcional). */
  node?: string;
  /** Id externo opcional; se ausente, o agendador gera um sequencial. */
  id?: string;
}

/**
 * Sub-tarefa de consulta gerada por keyset pagination:
 * - after: valor (id) do último resultado da sub-tarefa anterior (seek);
 * - limit: rate limiter da sub-tarefa — SEMPRE menor que costEstimate (>1).
 */
export interface SubQueryTask {
  jobId: string;
  seq: number;
  after: number | null;
  limit: number;
  node: string;
}

export type JobStatus =
  | 'queued-execution' // ocupa slot da fila de execução limitada
  | 'queued-waiting' // retido na fila de espera (backpressure)
  | 'running' // sub-tarefa em execução neste ciclo
  | 'completed'
  | 'cancelled'
  | 'migrated'; // substituído por um 2º job em outro nó (migração)

export type AdmissionTarget = 'execution' | 'waiting';

/**
 * Item de job: ocupa um slot da fila de execução desde o primeiro dequeue
 * até a conclusão de TODAS as sub-tarefas (mesmo re-enfileirado, continua contando).
 */
export interface JobRecord {
  jobId: string;
  query: string;
  params: Record<string, unknown>;
  costEstimate: number;
  node: string;
  status: JobStatus;
  /** Onde o job foi admitido na submissão. */
  admittedTo: AdmissionTarget;
  /** Sequência da última sub-tarefa completamente executada (marcação de progresso). */
  subTaskSeqCompleted: number;
  /** Valor (id) do último resultado retornado — encadeia a próxima sub-tarefa. */
  lastValue: number | null;
  /** Resultados agregados (ordenados, sem duplicatas). */
  rows: Row[];
  submittedAt: number;
  firstResultAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  waitingEnteredAt: number | null;
  promotedAt: number | null;
  migratedFrom: string | null;
  migratedTo: string | null;
  tasksExecuted: number;
}

/** Métricas públicas por job (latências relativas à submissão). */
export interface JobMetrics {
  jobId: string;
  status: JobStatus;
  admittedTo: AdmissionTarget;
  node: string;
  costEstimate: number;
  rowsReturned: number;
  tasksExecuted: number;
  submittedAt: number;
  /** Latência até o 1º resultado (ms simulados); null se nenhum resultado ainda. */
  firstResultLatencyMs: number | null;
  /** Latência até a conclusão total; null enquanto não concluído. */
  completionLatencyMs: number | null;
  /** Tempo retido na waiting queue; null se nunca esperou. */
  waitingTimeMs: number | null;
  migratedFrom: string | null;
  migratedTo: string | null;
}

/** Gera linhas determinísticas id=1..n (utilitário de testes/demo/CLI). */
export function generateRows(n: number, prefix = 'row'): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push({ id: i, value: `${prefix}-${i}` });
  }
  return rows;
}