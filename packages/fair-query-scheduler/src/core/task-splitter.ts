/**
 * fair-query-scheduler — src/core/task-splitter.ts
 *
 * Implementa funcionalmente o componente da patente US 9.092.482 B2 referente
 * à DIVISÃO DE UM JOB EM MÚLTIPLAS SUB-QUERY TASKS: (a) decisão por threshold —
 * se a estimativa de custo excede o custo-limiar configurado, o job é dividido;
 * caso contrário executa como task única; (b) geração preguiçosa (lazy) das
 * sub-tasks por keyset/seek pagination — a primeira task aplica um rate limiter
 * (LIMIT ≈ threshold) sem valor de seek; após cada execução, determina-se o
 * valor do último resultado retornado e a próxima task inclui esse valor
 * (WHERE id > lastValue ORDER BY id LIMIT N); o fim é detectado quando uma
 * task retorna menos linhas que o LIMIT.
 */

import type { Row, SubQueryTask } from './types.js';

/** Decisão por threshold: divide somente se o custo estimado exceder o limiar. */
export function shouldSplit(costEstimate: number, thresholdCost: number): boolean {
  return costEstimate > thresholdCost;
}

/**
 * LIMIT aplicado às sub-query tasks. Jobs divididos usam o threshold como
 * rate limiter; jobs não divididos executam como task única sem limite
 * prático (Number.MAX_SAFE_INTEGER).
 */
export function taskLimit(costEstimate: number, thresholdCost: number): number {
  const valid = thresholdCost === Number.POSITIVE_INFINITY
    || (Number.isInteger(thresholdCost) && thresholdCost >= 1);
  if (!valid) {
    throw new Error(`thresholdCost inválido: ${thresholdCost}`);
  }
  return shouldSplit(costEstimate, thresholdCost) ? thresholdCost : Number.MAX_SAFE_INTEGER;
}

/** Fim da paginação: uma task retornou menos linhas que o LIMIT. */
export function isExhausted(rowsReturned: number, limit: number): boolean {
  return rowsReturned < limit;
}

/**
 * Iterador lazy de sub-query tasks por keyset/seek pagination.
 *
 * - `peek()` produz a próxima SubQueryTask a executar (ou null se esgotado);
 * - `advance(rows)` registra o resultado: se veio menos que o LIMIT, marca o
 *   fim; senão determina o valor do último resultado retornado e o inclui na
 *   próxima task (`after = lastRow.id`).
 */
export class SubQueryTaskIterator {
  private seq: number;
  private after: number | undefined;
  private finished = false;

  constructor(
    private readonly jobId: string,
    private readonly limit: number,
    startSeq = 0,
    startAfter?: number,
  ) {
    this.seq = startSeq;
    this.after = startAfter;
  }

  /** Próxima sub-query task (sem consumir), ou null se não houver mais. */
  peek(): SubQueryTask | null {
    if (this.finished) return null;
    const task: SubQueryTask = { jobId: this.jobId, seq: this.seq, limit: this.limit };
    if (this.after !== undefined) task.after = this.after;
    return task;
  }

  /**
   * Registra as linhas retornadas pela task corrente e avança o iterador:
   * determina o último valor retornado (keyset) ou detecta o fim da carga.
   */
  advance(rows: Row[]): void {
    if (this.finished) return;
    if (isExhausted(rows.length, this.limit)) {
      this.finished = true;
      return;
    }
    const last = rows.at(-1);
    if (!last) {
      // LIMIT >= 1 e rows.length === limit implicam last definido; guarda defensiva.
      this.finished = true;
      return;
    }
    this.after = last.id;
    this.seq += 1;
  }

  get done(): boolean {
    return this.finished;
  }
}
