// bounded-fair-scheduler — testes do comparador fair-bounded vs FCFS (mecanismo 9).
import { describe, expect, it } from 'vitest';
import { runComparison } from '../src/core/compare.js';
import { DatabaseManagementSystem } from '../src/core/dbms.js';
import { generateRows } from '../src/core/types.js';

function dbms(): DatabaseManagementSystem {
  return DatabaseManagementSystem.uniform(['node-A', 'node-B'], generateRows(1000));
}

describe('runComparison — fair-bounded vs FCFS na mesma carga', () => {
  it('job pequeno tem latência de conclusão MENOR no fair-bounded que no FCFS', () => {
    const report = runComparison(
      [
        { query: 'pesada', costEstimate: 1000 },
        { query: 'leve-1', costEstimate: 10 },
        { query: 'leve-2', costEstimate: 10 },
        { query: 'leve-3', costEstimate: 10 },
      ],
      { dbms: dbms(), maxQueueSize: 8, maxTaskSize: 50 },
    );
    expect(report.jobs).toHaveLength(4);
    const lowCost = report.jobs.filter((j) => j.lowCost);
    expect(lowCost).toHaveLength(3);
    for (const j of lowCost) {
      expect(j.fairBounded.completionLatencyMs).not.toBeNull();
      expect(j.fcfs.completionLatencyMs).not.toBeNull();
      expect(j.fairBounded.completionLatencyMs ?? Infinity).toBeLessThan(
        j.fcfs.completionLatencyMs ?? -Infinity,
      );
    }
    // Redução agregada da latência dos jobs de baixo custo.
    expect(report.lowCost.count).toBe(3);
    expect(report.lowCost.fairBoundedAvgCompletionMs ?? Infinity).toBeLessThan(
      report.lowCost.fcfsAvgCompletionMs ?? -Infinity,
    );
    expect(report.lowCost.completionLatencyReductionPct ?? 0).toBeGreaterThan(0);
  });

  it('reporta waitingQueueEnqueuedCount da política fair-bounded', () => {
    const report = runComparison(
      [
        { query: 'a', costEstimate: 100 },
        { query: 'b', costEstimate: 100 },
        { query: 'c', costEstimate: 100 },
      ],
      { dbms: dbms(), maxQueueSize: 1, maxTaskSize: 50 },
    );
    expect(report.fairBounded.waitingQueueEnqueuedCount).toBe(2);
  });

  it('latência de 1º resultado do job grande atrás de outro grande: fair << FCFS', () => {
    const report = runComparison(
      [
        { query: 'g1', costEstimate: 1000 },
        { query: 'g2', costEstimate: 1000 },
      ],
      { dbms: dbms(), maxQueueSize: 8, maxTaskSize: 50 },
    );
    const g2 = report.jobs[1];
    expect(g2?.fairBounded.firstResultLatencyMs ?? Infinity).toBeLessThan(
      g2?.fcfs.firstResultLatencyMs ?? -Infinity,
    );
  });

  it('resultados agregados: médias preenchidas e jobIds estáveis', () => {
    const report = runComparison(
      [{ query: 'a', costEstimate: 10 }],
      { dbms: dbms(), maxQueueSize: 2, maxTaskSize: 50 },
    );
    expect(report.jobs[0]?.jobId).toBe('job-1');
    expect(report.fairBounded.avgCompletionLatencyMs).not.toBeNull();
    expect(report.fcfs.avgCompletionLatencyMs).not.toBeNull();
  });
});