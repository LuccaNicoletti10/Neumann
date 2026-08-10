/**
 * fair-query-scheduler — src/core/compare.ts
 *
 * Implementa funcionalmente o componente da patente US 9.092.482 B2 referente
 * à demonstração do efeito do escalonamento justo sobre as LATÊNCIAS: executa
 * a MESMA carga de jobs em dois modos — FCFS (sem divisão: cada job executa
 * como task única, na ordem de submissão) e FAIR (divisão por threshold +
 * fila round-robin) — e retorna as métricas lado a lado. No modo fair, jobs
 * de baixo custo (poucos resultados) apresentam latência até o primeiro
 * resultado e tempo de conclusão menores quando concorrem com jobs de alto
 * custo.
 */

import { DatabaseManagementSystem } from './dbms.js';
import { FairScheduler } from './scheduler.js';
import { FakeClock } from './types.js';
import type { JobMetrics, JobRequest } from './types.js';

export interface ComparisonConfig {
  dbms: DatabaseManagementSystem;
  /** Custo-limiar usado no modo fair. */
  thresholdCost: number;
  /** Instante inicial do relógio simulado em ambos os modos (default 0). */
  startMs?: number;
}

export interface ModeMetrics {
  mode: 'fcfs' | 'fair';
  thresholdCost: number;
  jobs: JobMetrics[];
  /** Tempo total simulado (ms) até a conclusão de todos os jobs. */
  totalElapsedMs: number;
}

export interface ComparisonResult {
  fcfs: ModeMetrics;
  fair: ModeMetrics;
}

/**
 * Executa a mesma carga nos modos FCFS e fair e compara as métricas.
 * No modo FCFS o threshold é infinito (nenhum job é dividido), reproduzindo
 * uma fila first-come-first-served de consultas monolíticas.
 */
export async function runComparison(
  requests: JobRequest[],
  config: ComparisonConfig,
): Promise<ComparisonResult> {
  const run = async (mode: 'fcfs' | 'fair', threshold: number): Promise<ModeMetrics> => {
    const clock = new FakeClock(config.startMs ?? 0);
    const scheduler = new FairScheduler({
      dbms: config.dbms,
      clock,
      thresholdCost: threshold,
    });
    for (const req of requests) scheduler.submit(req);
    const t0 = clock.now();
    await scheduler.runUntilIdle();
    return {
      mode,
      thresholdCost: threshold,
      jobs: scheduler.metrics(),
      totalElapsedMs: clock.now() - t0,
    };
  };

  const fcfs = await run('fcfs', Number.POSITIVE_INFINITY);
  const fair = await run('fair', config.thresholdCost);
  return { fcfs, fair };
}
