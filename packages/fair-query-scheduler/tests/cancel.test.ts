/**
 * Mecanismo 5 (cancelamento): job com sub-tasks pendentes é removido da fila,
 * marcado como cancelled e não executa mais; sub-task em voo não é
 * re-enfileirada.
 */
import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/core/scheduler.js';
import { FakeClock } from '../src/core/types.js';
import { singleNodeDbms } from './helpers.js';

describe('cancelamento', () => {
  it('cancela job ainda não iniciado: removido da fila, sem execução', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(1000), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 1000 });
    expect(scheduler.queueSize).toBe(1);

    expect(scheduler.cancel(id)).toBe(true);
    expect(scheduler.queueSize).toBe(0);

    await scheduler.runUntilIdle();
    const res = await scheduler.result(id);
    expect(res.state).toBe('cancelled');
    expect(res.rows).toHaveLength(0);
    expect(res.metrics.completionTimeMs).not.toBeNull();
  });

  it('cancela job com sub-tasks pendentes: não executa mais após o cancel', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(1000), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 1000 });

    scheduler.step(); // executa a 1ª sub-task (100 rows) e re-enfileira
    expect(scheduler.getJob(id)!.rows).toHaveLength(100);
    expect(scheduler.queueSize).toBe(1);

    expect(scheduler.cancel(id)).toBe(true);
    expect(scheduler.queueSize).toBe(0);

    await scheduler.runUntilIdle();
    const job = scheduler.getJob(id)!;
    expect(job.state).toBe('cancelled');
    expect(job.tasksExecuted).toBe(1); // nenhuma sub-task adicional
    expect(job.rows).toHaveLength(100);
  });

  it('cancelar job inexistente ou já concluído retorna false', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(10), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 10 });
    await scheduler.runUntilIdle();
    expect(scheduler.cancel(id)).toBe(false); // já done
    expect(scheduler.cancel('job-999')).toBe(false); // inexistente
  });
});
