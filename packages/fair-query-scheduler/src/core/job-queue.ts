/**
 * fair-query-scheduler — src/core/job-queue.ts
 *
 * Implementa funcionalmente o componente da patente US 9.092.482 B2 referente
 * à FILA DE EXECUÇÃO DE JOBS (job execution queue) com disciplina round-robin:
 * a fila tem frente e fim; itens são enfileirados no FIM, removidos da FRENTE
 * para executar a próxima sub-query task do job e, se ainda houver sub-tasks
 * pendentes, re-enfileirados no FIM. Suporta remoção por jobId (cancelamento
 * e migração de nó), tamanho e snapshot imutável para inspeção.
 */

import type { JobItem } from './types.js';

export class JobExecutionQueue {
  private items: JobItem[] = [];

  /** Enfileira o job item no FIM da fila. */
  enqueue(item: JobItem): void {
    this.items.push(item);
  }

  /** Remove e retorna o job item da FRENTE da fila (ou undefined se vazia). */
  dequeue(): JobItem | undefined {
    return this.items.shift();
  }

  /** Re-enfileira no FIM um job item que ainda possui sub-tasks pendentes. */
  reenqueue(item: JobItem): void {
    this.items.push(item);
  }

  /**
   * Remove TODOS os job items do job informado (cancelamento/migração).
   * Retorna os itens removidos, na ordem em que estavam na fila.
   */
  remove(jobId: string): JobItem[] {
    const removed: JobItem[] = [];
    const kept: JobItem[] = [];
    for (const item of this.items) {
      if (item.job.id === jobId) removed.push(item);
      else kept.push(item);
    }
    this.items = kept;
    return removed;
  }

  /** Quantidade de job items atualmente na fila. */
  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Cópia imutável da fila (frente → fim) para inspeção/testes. */
  snapshot(): readonly JobItem[] {
    return Object.freeze([...this.items]);
  }

  /** Ids dos jobs na fila, da frente para o fim. */
  jobIds(): string[] {
    return this.items.map((i) => i.job.id);
  }
}
