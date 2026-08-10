// bounded-fair-scheduler — testes do agendador: invariante bounded, round-robin justo,
// métricas e agregação final (mecanismos 1, 4, 5, 6, 9 e 10).
import { describe, expect, it } from 'vitest';
import { makeScheduler, ids } from './helpers.js';

describe('BoundedFairScheduler — invariante de admissão bounded (mecanismos 4 e 5)', () => {
  it('maxQueueSize=2 e 5 submits → exatamente 2 na execution e 3 na waiting', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 2 });
    const admitted: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = scheduler.submit({ query: `q${i}`, costEstimate: 10 });
      admitted.push(r.admitted);
    }
    expect(admitted).toEqual(['execution', 'execution', 'waiting', 'waiting', 'waiting']);
    const snap = scheduler.queueSnapshot();
    expect(snap.occupancy).toBe(2);
    expect(snap.execution.map((e) => e.jobId)).toEqual(['job-1', 'job-2']);
    expect(snap.waiting.map((e) => e.jobId)).toEqual(['job-3', 'job-4', 'job-5']);
    expect(scheduler.summary().waitingQueueEnqueuedCount).toBe(3);
  });

  it('waiting entra em FIFO conforme jobs completam; re-enfileirado nunca vai para waiting', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 2, rowCount: 100 });
    const completionOrder: string[] = [];
    for (let i = 0; i < 5; i += 1) scheduler.submit({ query: `q${i}`, costEstimate: 10 });
    // Executa passo a passo: jobs admitidos na execution (job-1, job-2) NUNCA
    // aparecem na waiting queue ao longo de toda a execução.
    while (scheduler.step()) {
      const waitingIds = scheduler.queueSnapshot().waiting.map((e) => e.jobId);
      expect(waitingIds).not.toContain('job-1');
      expect(waitingIds).not.toContain('job-2');
    }
    for (const m of scheduler.listMetrics()) {
      if (m.status === 'completed') completionOrder.push(m.jobId);
    }
    expect(completionOrder).toEqual(['job-1', 'job-2', 'job-3', 'job-4', 'job-5']);
    const summary = scheduler.summary();
    expect(summary.waitingQueueEnqueuedCount).toBe(3);
    expect(summary.promotedFromWaitingCount).toBe(3);
    // Todos os waiting foram promovidos (waitingTimeMs preenchido).
    for (const id of ['job-3', 'job-4', 'job-5']) {
      expect(scheduler.getMetrics(id)?.waitingTimeMs).not.toBeNull();
    }
  });

  it('submit rejeita costEstimate inválido', () => {
    const { scheduler } = makeScheduler();
    expect(() => scheduler.submit({ query: 'q', costEstimate: 0 })).toThrow();
    expect(() => scheduler.submit({ query: 'q', costEstimate: 1.5 })).toThrow();
  });

  it('job aceita parâmetros de query (mecanismo 1)', () => {
    const { scheduler } = makeScheduler();
    const { jobId } = scheduler.submit({
      query: 'SELECT * FROM t WHERE a = ?',
      costEstimate: 5,
      params: { a: 42 },
    });
    expect(scheduler.getRecord(jobId)?.params).toEqual({ a: 42 });
  });
});

describe('BoundedFairScheduler — round-robin justo com marcação de progresso (mecanismo 6)', () => {
  it('job grande (1000 rows) + pequenos (10 rows): pequenos completam ANTES do grande', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 10, rowCount: 1000 });
    const big = scheduler.submit({ query: 'pesada', costEstimate: 1000 });
    const smalls = [
      scheduler.submit({ query: 'p1', costEstimate: 10 }),
      scheduler.submit({ query: 'p2', costEstimate: 10 }),
      scheduler.submit({ query: 'p3', costEstimate: 10 }),
    ];
    scheduler.runUntilIdle();
    const bigM = scheduler.getMetrics(big.jobId);
    expect(bigM?.status).toBe('completed');
    expect(bigM?.rowsReturned).toBe(1000);
    for (const s of smalls) {
      const m = scheduler.getMetrics(s.jobId);
      expect(m?.status).toBe('completed');
      expect(m?.completionLatencyMs).not.toBeNull();
      expect(bigM?.completionLatencyMs).not.toBeNull();
      expect(m?.completionLatencyMs ?? Infinity).toBeLessThan(
        bigM?.completionLatencyMs ?? -Infinity,
      );
      expect(m?.firstResultLatencyMs).not.toBeNull();
      expect(m?.firstResultLatencyMs ?? Infinity).toBeLessThanOrEqual(
        m?.completionLatencyMs ?? -Infinity,
      );
    }
  });

  it('cada step() executa exatamente UMA sub-task e marca progresso (seq + lastValue)', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 4, rowCount: 1000 });
    const { jobId } = scheduler.submit({ query: 'grande', costEstimate: 1000 });
    expect(scheduler.step()).toBe(true);
    let rec = scheduler.getRecord(jobId);
    expect(rec?.subTaskSeqCompleted).toBe(1);
    expect(rec?.lastValue).toBe(50); // limit = min(50, 999)
    expect(rec?.rows).toHaveLength(50);
    expect(rec?.status).toBe('queued-execution'); // re-enfileirado, NÃO completo
    expect(scheduler.step()).toBe(true);
    rec = scheduler.getRecord(jobId);
    expect(rec?.subTaskSeqCompleted).toBe(2);
    expect(rec?.lastValue).toBe(100);
    expect(rec?.rows).toHaveLength(100);
  });

  it('step() retorna false quando não há trabalho; runUntilIdle drena tudo', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 2 });
    expect(scheduler.step()).toBe(false);
    scheduler.submit({ query: 'a', costEstimate: 10 });
    scheduler.submit({ query: 'b', costEstimate: 10 });
    scheduler.submit({ query: 'c', costEstimate: 10 }); // waiting
    const steps = scheduler.runUntilIdle();
    expect(steps).toBeGreaterThan(0);
    expect(scheduler.step()).toBe(false);
    expect(scheduler.queueSnapshot().occupancy).toBe(0);
    expect(scheduler.queueSnapshot().waiting).toEqual([]);
  });

  it('latência do 1º resultado é menor que a de conclusão para job grande (progressivo)', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 4, rowCount: 1000 });
    const { jobId } = scheduler.submit({ query: 'grande', costEstimate: 1000 });
    scheduler.runUntilIdle();
    const m = scheduler.getMetrics(jobId);
    expect(m?.firstResultLatencyMs).not.toBeNull();
    expect(m?.completionLatencyMs).not.toBeNull();
    expect(m?.firstResultLatencyMs ?? Infinity).toBeLessThan(
      m?.completionLatencyMs ?? -Infinity,
    );
  });
});

describe('BoundedFairScheduler — agregação final (mecanismo 10)', () => {
  it('1000 rows completas, ordenadas e sem duplicatas', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 4, rowCount: 1000 });
    const { jobId } = scheduler.submit({ query: 'full scan', costEstimate: 1000 });
    scheduler.runUntilIdle();
    const rec = scheduler.getRecord(jobId);
    expect(rec?.status).toBe('completed');
    expect(rec?.rows).toHaveLength(1000);
    const got = ids(rec?.rows ?? []);
    expect(new Set(got).size).toBe(1000);
    expect(got).toEqual([...Array(1000)].map((_, i) => i + 1));
  });

  it('carga mista completa: cada job agrega exatamente min(costEstimate, fonte) rows, sem perda', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 2, rowCount: 200 });
    const submitted: Array<{ jobId: string; expected: number }> = [
      { jobId: scheduler.submit({ query: 'a', costEstimate: 200 }).jobId, expected: 200 },
      { jobId: scheduler.submit({ query: 'b', costEstimate: 10 }).jobId, expected: 10 },
      { jobId: scheduler.submit({ query: 'c', costEstimate: 10 }).jobId, expected: 10 },
    ];
    scheduler.runUntilIdle();
    for (const { jobId, expected } of submitted) {
      const rec = scheduler.getRecord(jobId);
      expect(rec?.status).toBe('completed');
      expect(rec?.rows).toHaveLength(expected);
      const got = ids(rec?.rows ?? []);
      expect(new Set(got).size).toBe(expected);
      expect(got).toEqual([...Array(expected)].map((_, i) => i + 1));
    }
  });
});