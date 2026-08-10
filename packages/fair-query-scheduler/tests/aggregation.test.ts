/**
 * Mecanismo 3/4 (agregação de resultados parciais): o resultado final de um
 * job grande contém TODAS as 1000 rows, em ordem de chave, sem duplicatas.
 */
import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/core/scheduler.js';
import { FakeClock } from '../src/core/types.js';
import { genRows, singleNodeDbms } from './helpers.js';

describe('agregação de resultados parciais', () => {
  it('job grande: resultado final = 1000 rows em ordem, sem duplicatas', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(1000), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 1000 });
    await scheduler.runUntilIdle();
    const res = await scheduler.result(id);

    expect(res.state).toBe('done');
    expect(res.rows).toHaveLength(1000);
    expect(res.rows.map((r) => r.id)).toEqual(genRows(1000).map((r) => r.id));
    expect(new Set(res.rows.map((r) => r.id)).size).toBe(1000); // sem duplicatas
  });

  it('agregação correta também com concorrência (interleaving round-robin)', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(1000), clock: new FakeClock(), thresholdCost: 64 });
    const big = scheduler.submit({ query: 't', costEstimate: 1000 });
    scheduler.submit({ query: 'small', costEstimate: 10 });
    scheduler.submit({ query: 'small', costEstimate: 10 });
    await scheduler.runUntilIdle();
    const res = await scheduler.result(big);
    expect(res.rows.map((r) => r.id)).toEqual(genRows(1000).map((r) => r.id));
  });
});
