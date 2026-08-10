/**
 * Mecanismo 4 (fila round-robin): 1 job de alto custo (1000 rows) + 3 jobs de
 * baixo custo (10 rows) submetidos juntos → no modo fair, os 3 jobs pequenos
 * completam ANTES do job grande; verifica a ordem de conclusão e o ciclo
 * dequeue → executa próxima sub-task → re-enfileira no FIM.
 */
import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/core/scheduler.js';
import { FakeClock } from '../src/core/types.js';
import { singleNodeDbms } from './helpers.js';

function setup() {
  const scheduler = new FairScheduler({ dbms: singleNodeDbms(1000), clock: new FakeClock(), thresholdCost: 100 });
  const big = scheduler.submit({ query: 't', costEstimate: 1000 });
  const smalls = [
    scheduler.submit({ query: 'small', costEstimate: 10 }),
    scheduler.submit({ query: 'small', costEstimate: 10 }),
    scheduler.submit({ query: 'small', costEstimate: 10 }),
  ];
  return { scheduler, big, smalls };
}

describe('round-robin justo', () => {
  it('os 3 jobs pequenos completam ANTES do job grande', async () => {
    const { scheduler, big, smalls } = setup();
    await scheduler.runUntilIdle();

    const bigJob = scheduler.getJob(big)!;
    for (const s of smalls) {
      const sj = scheduler.getJob(s)!;
      expect(sj.state).toBe('done');
      expect(sj.completedAt!).toBeLessThan(bigJob.completedAt!);
    }
    expect(bigJob.state).toBe('done');
  });

  it('ciclo: dequeue da frente, executa 1 sub-task, re-enfileira no FIM', () => {
    const { scheduler, big, smalls } = setup();
    expect(scheduler.queueSize).toBe(4);

    // 1º ciclo: job grande sai da frente, executa a 1ª sub-task e volta ao FIM.
    expect(scheduler.step()).toBe(true);
    expect(scheduler.getJob(big)!.tasksExecuted).toBe(1);
    expect(scheduler.getJob(big)!.rows).toHaveLength(100);
    expect(scheduler.queueSize).toBe(4); // re-enfileirado

    // Próximos 3 ciclos: os pequenos completam (1 task cada, sem re-enqueue).
    for (const s of smalls) {
      expect(scheduler.step()).toBe(true);
    }
    for (const s of smalls) {
      expect(scheduler.getJob(s)!.state).toBe('done');
    }
    expect(scheduler.queueSize).toBe(1); // só o grande permanece
    expect(scheduler.getJob(big)!.state).toBe('queued');
  });

  it('step() retorna false quando a fila esvazia', async () => {
    const { scheduler } = setup();
    await scheduler.runUntilIdle();
    expect(scheduler.step()).toBe(false);
  });
});
