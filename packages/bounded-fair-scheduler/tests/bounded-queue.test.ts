// bounded-fair-scheduler — testes da fila bounded + waiting queue (mecanismos 4 e 5).
import { describe, expect, it } from 'vitest';
import { BoundedJobQueue } from '../src/core/bounded-queue.js';
import type { JobRecord } from '../src/core/types.js';

function rec(jobId: string): JobRecord {
  return {
    jobId,
    query: `q-${jobId}`,
    params: {},
    costEstimate: 100,
    node: 'node-A',
    status: 'queued-execution',
    admittedTo: 'execution',
    subTaskSeqCompleted: 0,
    lastValue: null,
    rows: [],
    submittedAt: 0,
    firstResultAt: null,
    completedAt: null,
    cancelledAt: null,
    waitingEnteredAt: null,
    promotedAt: null,
    migratedFrom: null,
    migratedTo: null,
    tasksExecuted: 0,
  };
}

describe('BoundedJobQueue — admissão com backpressure (mecanismo 4)', () => {
  it('maxQueueSize=2, 5 admits → 2 execution + 3 waiting (FIFO)', () => {
    const q = new BoundedJobQueue(2);
    const admitted = ['j1', 'j2', 'j3', 'j4', 'j5'].map((id) => q.admit(rec(id)));
    expect(admitted).toEqual(['execution', 'execution', 'waiting', 'waiting', 'waiting']);
    expect(q.occupancy()).toBe(2);
    expect(q.isFull()).toBe(true);
    expect(q.waitingLength()).toBe(3);
  });

  it('snapshot reflete posições 1-based das duas filas', () => {
    const q = new BoundedJobQueue(2);
    ['j1', 'j2', 'j3', 'j4', 'j5'].forEach((id) => q.admit(rec(id)));
    const snap = q.snapshot();
    expect(snap.maxQueueSize).toBe(2);
    expect(snap.occupancy).toBe(2);
    expect(snap.isFull).toBe(true);
    expect(snap.execution).toEqual([
      { jobId: 'j1', position: 1 },
      { jobId: 'j2', position: 2 },
    ]);
    expect(snap.waiting).toEqual([
      { jobId: 'j3', position: 1 },
      { jobId: 'j4', position: 2 },
      { jobId: 'j5', position: 3 },
    ]);
  });

  it('rejeita maxQueueSize inválido', () => {
    expect(() => new BoundedJobQueue(0)).toThrow();
    expect(() => new BoundedJobQueue(1.5)).toThrow();
  });
});

describe('BoundedJobQueue — ocupação conta item em voo até a conclusão total', () => {
  it('item dequeued continua ocupando slot (submit durante "voo" vai para waiting)', () => {
    const q = new BoundedJobQueue(1);
    q.admit(rec('j1'));
    const dequeued = q.dequeue();
    expect(dequeued?.jobId).toBe('j1');
    expect(q.occupancy()).toBe(1); // em voo, ainda ocupa
    expect(q.isFull()).toBe(true);
    expect(q.admit(rec('j2'))).toBe('waiting'); // backpressure mesmo com j1 em voo
  });

  it('re-enqueue NUNCA vai para waiting mesmo com fila cheia (mecanismo 5)', () => {
    const q = new BoundedJobQueue(1);
    q.admit(rec('j1'));
    q.admit(rec('j2')); // waiting
    const d = q.dequeue();
    expect(d?.jobId).toBe('j1');
    if (d) q.reenqueue(d);
    expect(q.snapshot().execution.map((e) => e.jobId)).toEqual(['j1']);
    expect(q.snapshot().waiting.map((e) => e.jobId)).toEqual(['j2']);
    expect(q.occupancy()).toBe(1);
  });

  it('slot só é liberado na conclusão total; promoção entra no FIM da execution (FIFO da waiting)', () => {
    const q = new BoundedJobQueue(2);
    ['j1', 'j2', 'j3', 'j4'].forEach((id) => q.admit(rec(id)));
    // j1 e j2 executam uma sub-task e voltam: nenhum slot liberado
    const d1 = q.dequeue();
    if (d1) q.reenqueue(d1);
    const d2 = q.dequeue();
    if (d2) q.reenqueue(d2);
    expect(q.waitingLength()).toBe(2);
    // j1 COMPLETA → 1º da waiting (j3) entra no FIM da execution
    const d3 = q.dequeue(); // j1
    expect(d3?.jobId).toBe('j1');
    const promoted = q.complete('j1');
    expect(promoted?.jobId).toBe('j3');
    expect(q.snapshot().execution.map((e) => e.jobId)).toEqual(['j2', 'j3']);
    // j2 completa → j4 promovido
    const d4 = q.dequeue();
    expect(d4?.jobId).toBe('j2');
    const promoted2 = q.complete('j2');
    expect(promoted2?.jobId).toBe('j4');
    expect(q.snapshot().execution.map((e) => e.jobId)).toEqual(['j3', 'j4']);
    expect(q.waitingLength()).toBe(0);
  });

  it('complete de job inexistente falha', () => {
    const q = new BoundedJobQueue(1);
    expect(() => q.complete('nope')).toThrow();
  });
});

describe('BoundedJobQueue — remove (cancelamento nas duas filas)', () => {
  it('remover da execution libera slot e promove waiting', () => {
    const q = new BoundedJobQueue(1);
    q.admit(rec('j1'));
    q.admit(rec('j2'));
    const removal = q.remove('j1');
    expect(removal?.from).toBe('execution');
    expect(removal?.promoted?.jobId).toBe('j2');
    expect(q.snapshot().execution.map((e) => e.jobId)).toEqual(['j2']);
    expect(q.waitingLength()).toBe(0);
  });

  it('remover da waiting NÃO promove ninguém e não mexe na execution', () => {
    const q = new BoundedJobQueue(1);
    q.admit(rec('j1'));
    q.admit(rec('j2'));
    q.admit(rec('j3'));
    const removal = q.remove('j2');
    expect(removal?.from).toBe('waiting');
    expect(removal?.promoted).toBeNull();
    expect(q.snapshot().execution.map((e) => e.jobId)).toEqual(['j1']);
    expect(q.snapshot().waiting.map((e) => e.jobId)).toEqual(['j3']);
  });

  it('remover job inexistente retorna null', () => {
    const q = new BoundedJobQueue(1);
    expect(q.remove('nope')).toBeNull();
  });
});