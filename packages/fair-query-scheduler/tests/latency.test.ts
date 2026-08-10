/**
 * Mecanismo 7 (latência simulada determinística): o FakeClock avança
 * baseMs + perRowMs × rows por task; as métricas (latência até o 1º resultado
 * e tempo de conclusão) refletem exatamente esses valores.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseManagementSystem, DatabaseNode } from '../src/core/dbms.js';
import { FairScheduler } from '../src/core/scheduler.js';
import { FakeClock } from '../src/core/types.js';
import { genRows, singleNodeDbms } from './helpers.js';

// DEFAULT_LATENCY: baseMs=5, perRowMs=1

describe('latência simulada via Clock injetável', () => {
  it('task única: 1º resultado e conclusão = baseMs + perRowMs × rows', async () => {
    const clock = new FakeClock(0);
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(10), clock, thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 10 });
    await scheduler.runUntilIdle();

    const m = scheduler.metricsOf(id)!;
    expect(m.firstResultLatencyMs).toBe(5 + 1 * 10); // 15
    expect(m.completionTimeMs).toBe(15);
    expect(clock.now()).toBe(15); // nenhum tempo além da latência simulada
  });

  it('job dividido: conclusão = soma das latências de todas as sub-tasks', async () => {
    const clock = new FakeClock(0);
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(250), clock, thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 250 });
    await scheduler.runUntilIdle();

    const m = scheduler.metricsOf(id)!;
    // tasks: 100, 100, 50 rows → (5+100)+(5+100)+(5+50) = 265
    expect(m.firstResultLatencyMs).toBe(105);
    expect(m.completionTimeMs).toBe(265);
    expect(clock.now()).toBe(265);
  });

  it('latência por nó é configurável (baseMs/perRowMs customizados)', async () => {
    const dbms = new DatabaseManagementSystem([
      new DatabaseNode('fast', { t: genRows(20) }, { baseMs: 2, perRowMs: 0.5 }),
    ]);
    const clock = new FakeClock(0);
    const scheduler = new FairScheduler({ dbms, clock, thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 20 });
    await scheduler.runUntilIdle();
    expect(scheduler.metricsOf(id)!.completionTimeMs).toBe(2 + 0.5 * 20); // 12
  });

  it('determinismo: mesma carga, mesmo clock inicial → mesmas métricas', async () => {
    const run = async () => {
      const clock = new FakeClock(1000);
      const s = new FairScheduler({ dbms: singleNodeDbms(500), clock, thresholdCost: 100 });
      s.submit({ query: 't', costEstimate: 500 });
      s.submit({ query: 't', costEstimate: 10 });
      await s.runUntilIdle();
      return s.metrics();
    };
    expect(await run()).toEqual(await run());
  });
});
