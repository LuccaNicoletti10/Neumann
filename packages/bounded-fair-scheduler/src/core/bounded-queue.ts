// bounded-fair-scheduler — fila de execução de jobs LIMITADA (bounded) + fila de espera.
// Implementa funcionalmente, de forma independente, o componente central da patente
// US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads"): uma job execution
// queue com tamanho MÁXIMO configurável, em que um item ocupa slot enquanto "ao menos uma
// porção do job foi iniciada mas não completada" — do primeiro dequeue até a última
// sub-tarefa terminar. Jobs excedentes vão para uma waiting queue FIFO separada e só são
// promovidos quando um job existente COMPLETA (ou é cancelado/removido), liberando o slot.
// Nenhum texto dos claims é reproduzido; esta é uma reimplementação original.

import type { JobRecord } from './types.js';

export interface QueueSnapshotEntry {
  jobId: string;
  /** Posição 1-based dentro da sua fila. */
  position: number;
}

export interface QueueSnapshot {
  maxQueueSize: number;
  /** Slots ocupados = itens na execution queue + itens em voo (dequeued, executando). */
  occupancy: number;
  isFull: boolean;
  execution: QueueSnapshotEntry[];
  inFlight: string[];
  waiting: QueueSnapshotEntry[];
}

export type RemovalLocation = 'execution' | 'inflight' | 'waiting';

export interface RemovalResult {
  record: JobRecord;
  from: RemovalLocation;
  /** Item promovido da waiting queue ao liberar um slot (null se nenhum). */
  promoted: JobRecord | null;
}

/**
 * Fila de execução bounded com backpressure:
 * - admit(): se não está cheia → entra no FIM da execution queue; se está cheia →
 *   vai para a waiting queue (FIFO) separada.
 * - dequeue()/reenqueue(): round-robin; um item re-enfileirado NUNCA vai para a
 *   waiting queue — apenas volta ao fim da execution queue, continuando a ocupar slot.
 * - complete(): libera o slot SOMENTE na conclusão total do job e promove o 1º da
 *   waiting queue (que entra no FIM da execution queue).
 * - remove(): cancelamento/remoção das duas filas; remover ocupante libera slot.
 */
export class BoundedJobQueue {
  readonly maxQueueSize: number;
  private execution: JobRecord[] = [];
  private readonly inFlight = new Map<string, JobRecord>();
  private waiting: JobRecord[] = [];

  constructor(maxQueueSize: number) {
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new Error('BoundedJobQueue: maxQueueSize deve ser inteiro >= 1');
    }
    this.maxQueueSize = maxQueueSize;
  }

  /** Ocupação: itens enfileirados + itens em voo continuam contando como ocupantes. */
  occupancy(): number {
    return this.execution.length + this.inFlight.size;
  }

  isFull(): boolean {
    return this.occupancy() >= this.maxQueueSize;
  }

  waitingLength(): number {
    return this.waiting.length;
  }

  /** Admissão com backpressure. Retorna onde o item foi colocado. */
  admit(record: JobRecord): 'execution' | 'waiting' {
    if (this.isFull()) {
      this.waiting.push(record);
      return 'waiting';
    }
    this.execution.push(record);
    return 'execution';
  }

  /** Remove o item da frente; ele passa a "em voo" e CONTINUA ocupando slot. */
  dequeue(): JobRecord | undefined {
    const rec = this.execution.shift();
    if (rec !== undefined) this.inFlight.set(rec.jobId, rec);
    return rec;
  }

  /**
   * Re-enfileira no FIM da execution queue (round-robin), indicando progresso.
   * NUNCA vai para a waiting queue, mesmo com a fila cheia.
   */
  reenqueue(record: JobRecord): void {
    if (!this.inFlight.delete(record.jobId)) {
      throw new Error(`reenqueue: job ${record.jobId} não estava em voo`);
    }
    this.execution.push(record);
  }

  /**
   * Conclusão total do job: remove o ocupante (em voo ou enfileirado), libera o
   * slot e promove o 1º da waiting queue (se houver), que entra no FIM da execution.
   * Retorna o item promovido (ou null).
   */
  complete(jobId: string): JobRecord | null {
    const wasInFlight = this.inFlight.delete(jobId);
    const idx = this.execution.findIndex((r) => r.jobId === jobId);
    if (!wasInFlight && idx === -1) {
      throw new Error(`complete: job ${jobId} não ocupa slot da execution queue`);
    }
    if (idx !== -1) this.execution.splice(idx, 1);
    return this.promoteNext();
  }

  /**
   * Remove um job item da execution queue (enfileirado ou em voo) ou da waiting
   * queue. Remover um ocupante da execution libera slot e promove o 1º da waiting.
   */
  remove(jobId: string): RemovalResult | null {
    const inFlightRec = this.inFlight.get(jobId);
    if (inFlightRec !== undefined) {
      this.inFlight.delete(jobId);
      return { record: inFlightRec, from: 'inflight', promoted: this.promoteNext() };
    }
    const execIdx = this.execution.findIndex((r) => r.jobId === jobId);
    if (execIdx !== -1) {
      const [rec] = this.execution.splice(execIdx, 1);
      if (rec === undefined) return null;
      return { record: rec, from: 'execution', promoted: this.promoteNext() };
    }
    const waitIdx = this.waiting.findIndex((r) => r.jobId === jobId);
    if (waitIdx !== -1) {
      const [rec] = this.waiting.splice(waitIdx, 1);
      if (rec === undefined) return null;
      // Remover da waiting queue NÃO libera slot de execução → ninguém é promovido.
      return { record: rec, from: 'waiting', promoted: null };
    }
    return null;
  }

  /** Promove o 1º da waiting queue (FIFO) para o FIM da execution queue, se houver vaga. */
  private promoteNext(): JobRecord | null {
    if (this.waiting.length === 0 || this.isFull()) return null;
    const next = this.waiting.shift();
    if (next === undefined) return null;
    this.execution.push(next);
    return next;
  }

  get(jobId: string): JobRecord | undefined {
    return (
      this.inFlight.get(jobId) ??
      this.execution.find((r) => r.jobId === jobId) ??
      this.waiting.find((r) => r.jobId === jobId)
    );
  }

  has(jobId: string): boolean {
    return this.get(jobId) !== undefined;
  }

  executionIds(): string[] {
    return this.execution.map((r) => r.jobId);
  }

  waitingIds(): string[] {
    return this.waiting.map((r) => r.jobId);
  }

  snapshot(): QueueSnapshot {
    return {
      maxQueueSize: this.maxQueueSize,
      occupancy: this.occupancy(),
      isFull: this.isFull(),
      execution: this.execution.map((r, i) => ({ jobId: r.jobId, position: i + 1 })),
      inFlight: [...this.inFlight.keys()],
      waiting: this.waiting.map((r, i) => ({ jobId: r.jobId, position: i + 1 })),
    };
  }

  /** Restaura filas a partir de registros (usado por snapshots/CLI). */
  restore(execution: JobRecord[], waiting: JobRecord[]): void {
    if (execution.length > this.maxQueueSize) {
      throw new Error('restore: execution excede maxQueueSize');
    }
    this.execution = [...execution];
    this.waiting = [...waiting];
    this.inFlight.clear();
  }
}