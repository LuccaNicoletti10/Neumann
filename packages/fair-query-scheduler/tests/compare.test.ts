/**
 * Mecanismo 7 (métricas + comparador): a mesma carga em modo FCFS (sem
 * divisão) × fair (round-robin); job pequeno atrás do grande tem latência
 * MAIOR no modo FCFS do que no modo fair.
 */
import { describe, expect, it } from 'vitest';
import { runComparison } from '../src/core/compare.js';
import { singleNodeDbms } from './helpers.js';

describe('comparação FCFS × fair', () => {
  it('job pequeno atrás do grande: latência maior em FCFS que em fair', async () => {
    const load = [
      { query: 't', costEstimate: 1000 }, // job-1 grande
      { query: 'small', costEstimate: 10 },   // job-2 pequeno (atrás do grande)
      { query: 'small', costEstimate: 10 },   // job-3 pequeno
    ];
    const result = await runComparison(load, { dbms: singleNodeDbms(1000), thresholdCost: 100 });

    expect(result.fcfs.jobs).toHaveLength(3);
    expect(result.fair.jobs).toHaveLength(3);

    // FCFS: o grande não é dividido (task única).
    expect(result.fcfs.jobs[0]!.tasksExecuted).toBe(1);
    // Fair: o grande é dividido em várias tasks.
    expect(result.fair.jobs[0]!.tasksExecuted).toBeGreaterThan(1);

    // Jobs pequenos: conclusão e 1º resultado muito mais cedo no modo fair.
    for (const i of [1, 2]) {
      const fcfs = result.fcfs.jobs[i]!;
      const fair = result.fair.jobs[i]!;
      expect(fair.completionTimeMs!).toBeLessThan(fcfs.completionTimeMs!);
      expect(fair.firstResultLatencyMs!).toBeLessThan(fcfs.firstResultLatencyMs!);
    }

    // No modo fair, os pequenos completam antes do grande.
    const fairBig = result.fair.jobs[0]!;
    for (const i of [1, 2]) {
      expect(result.fair.jobs[i]!.completionTimeMs!).toBeLessThan(fairBig.completionTimeMs!);
    }
  });
});
