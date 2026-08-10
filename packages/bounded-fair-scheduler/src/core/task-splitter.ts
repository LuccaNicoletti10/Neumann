// bounded-fair-scheduler — divisor de sub-tarefas (task splitter) com keyset chaining.
// Implementa funcionalmente, de forma independente, os componentes "dividir um job de
// consulta em sub-tarefas, cada uma configurada para retornar MENOS resultados que a
// estimativa de custo" e "determinar o valor do último resultado para encadear a próxima
// sub-tarefa" descritos na patente US 9,715,526 B2 (Palantir, "Fair Scheduling for
// Mixed-Query Loads"). Nenhum texto dos claims é reproduzido.

import type { SubQueryTask } from './types.js';

/**
 * Escolhe o rate limiter (LIMIT) da sub-tarefa.
 * INVARIANTE: quando costEstimate > 1, o limite retornado é SEMPRE < costEstimate.
 * Quando costEstimate <= 1, uma única sub-tarefa de limite 1 resolve o job.
 */
export function chooseTaskLimit(costEstimate: number, maxTaskSize: number): number {
  if (!Number.isInteger(costEstimate) || costEstimate < 1) {
    throw new Error('chooseTaskLimit: costEstimate deve ser inteiro >= 1');
  }
  if (!Number.isInteger(maxTaskSize) || maxTaskSize < 1) {
    throw new Error('chooseTaskLimit: maxTaskSize deve ser inteiro >= 1');
  }
  if (costEstimate === 1) return 1;
  return Math.max(1, Math.min(maxTaskSize, costEstimate - 1));
}

export interface SplitterState {
  jobId: string;
  node: string;
  /** Sequência da última sub-tarefa completamente executada (0 = nenhuma). */
  subTaskSeqCompleted: number;
  /** Valor (id) do último resultado retornado; null antes da 1ª sub-tarefa. */
  lastValue: number | null;
  /** Quantidade de resultados já agregados pelo job. */
  rowsCollected: number;
}

/**
 * Geração LAZY da próxima sub-tarefa keyset:
 * - a 1ª sub-tarefa tem after = null (sem seek) e rate limiter LIMIT N;
 * - cada sub-tarefa seguinte inclui o valor do último resultado da anterior
 *   (after = lastValue), implementando seek pagination sem OFFSET;
 * - o rate limiter nunca excede o que falta para a estimativa de custo
 *   (mantendo SEMPRE limit < costEstimate quando costEstimate > 1).
 */
export function nextSubTask(
  state: SplitterState,
  costEstimate: number,
  maxTaskSize: number,
): SubQueryTask {
  const base = chooseTaskLimit(costEstimate, maxTaskSize);
  const remaining = Math.max(1, costEstimate - state.rowsCollected);
  return {
    jobId: state.jobId,
    seq: state.subTaskSeqCompleted + 1,
    after: state.lastValue,
    limit: Math.min(base, remaining),
    node: state.node,
  };
}

/**
 * Condição de término do encadeamento: a fonte está esgotada quando uma
 * sub-tarefa retorna MENOS linhas que o seu rate limiter.
 */
export function isChainExhausted(rowsReturned: number, taskLimit: number): boolean {
  return rowsReturned < taskLimit;
}

/** Condição de término alternativa: a estimativa de custo já foi atingida. */
export function isEstimateReached(rowsCollected: number, costEstimate: number): boolean {
  return rowsCollected >= costEstimate;
}