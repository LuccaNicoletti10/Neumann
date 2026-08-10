// bounded-fair-scheduler — testes de cancelamento (mecanismo 7).
import { describe, expect, it } from 'vitest';
import { makeScheduler } from './helpers.js';

describe('cancelamento na execution queue', () => {
  it('libera o slot e promove o 1º da waiting queue', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 1, rowCount: 1000 });
    const a = scheduler.submit({ query: 'grande', costEstimate: 1000 }); // execution
    const b = scheduler.submit({ query: 'media', costEstimate: 100 }); // waiting
    const c = scheduler.submit({ query: 'pequena', costEstimate: 10 }); // waiting
    expect(scheduler.queueSnapshot().waiting.map((e) => e.jobId)).toEqual([
      b.jobId,
      c.jobId,
    ]);

    expect(scheduler.cancel(a.jobId)).toBe(true);
    expect(scheduler.getRecord(a.jobId)?.status).toBe('cancelled');
    expect(scheduler.getRecord(a.jobId)?.cancelledAt).not.toBeNull();

    const snap = scheduler.queueSnapshot();
    expect(snap.occupancy).toBe(1);
    expect(snap.execution.map((e) => e.jobId)).toEqual([b.jobId]);
    expect(snap.waiting.map((e) => e.jobId)).toEqual([c.jobId]);
    // Promovido tem marca temporal de promoção e status de execution.
    expect(scheduler.getRecord(b.jobId)?.promotedAt).not.toBeNull();
    expect(scheduler.getRecord(b.jobId)?.status).toBe('queued-execution');
    expect(scheduler.summary().promotedFromWaitingCount).toBe(1);
  });

  it('cancelamento no meio da execução (após 1 sub-task) também libera slot', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 1, rowCount: 1000 });
    const a = scheduler.submit({ query: 'grande', costEstimate: 1000 });
    const b = scheduler.submit({ query: 'pequena', costEstimate: 10 });
    scheduler.step(); // a executa 1 sub-task e volta ao fim (continua ocupando)
    expect(scheduler.getRecord(a.jobId)?.subTaskSeqCompleted).toBe(1);
    expect(scheduler.cancel(a.jobId)).toBe(true);
    expect(scheduler.queueSnapshot().execution.map((e) => e.jobId)).toEqual([b.jobId]);
    scheduler.runUntilIdle();
    expect(scheduler.getRecord(b.jobId)?.status).toBe('completed');
  });
});

describe('cancelamento na waiting queue', () => {
  it('some da waiting sem afetar a execution e sem promover ninguém', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 1, rowCount: 1000 });
    const a = scheduler.submit({ query: 'grande', costEstimate: 1000 });
    const b = scheduler.submit({ query: 'b', costEstimate: 100 });
    const c = scheduler.submit({ query: 'c', costEstimate: 10 });

    expect(scheduler.cancel(b.jobId)).toBe(true);
    expect(scheduler.getRecord(b.jobId)?.status).toBe('cancelled');
    const snap = scheduler.queueSnapshot();
    expect(snap.execution.map((e) => e.jobId)).toEqual([a.jobId]);
    expect(snap.waiting.map((e) => e.jobId)).toEqual([c.jobId]);
    expect(scheduler.summary().promotedFromWaitingCount).toBe(0);

    // O cancelado não executa nunca.
    scheduler.runUntilIdle();
    expect(scheduler.getRecord(b.jobId)?.status).toBe('cancelled');
    expect(scheduler.getRecord(b.jobId)?.rows).toHaveLength(0);
    expect(scheduler.getRecord(a.jobId)?.status).toBe('completed');
    expect(scheduler.getRecord(c.jobId)?.status).toBe('completed');
  });

  it('cancel de job inexistente ou já concluído retorna false', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 2 });
    expect(scheduler.cancel('nope')).toBe(false);
    const { jobId } = scheduler.submit({ query: 'x', costEstimate: 10 });
    scheduler.runUntilIdle();
    expect(scheduler.cancel(jobId)).toBe(false); // já completou
  });
});