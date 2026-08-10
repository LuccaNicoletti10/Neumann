// bounded-fair-scheduler — comparador fair-bounded vs FCFS.
// Implementa funcionalmente, de forma independente, o componente de avaliação da patente
// US 9,715,526 B2 (Palantir, "Fair Scheduling for Mixed-Query Loads"): comparar o
// agendamento justo com fila limitada contra uma linha de base FCFS (first-come,
// first-served), evidenciando a redução de latência dos jobs de BAIXO custo quando
// misturados com jobs de alto custo. Nenhum texto dos claims é reproduzido.

import type { DatabaseManagementSystem } from './dbms.js';
import { BoundedFairScheduler } from './scheduler.js';
import { chooseTaskLimit, isChainExhausted } from './task-splitter.js';
import { ManualClock } from './types.js';
import type { QueryJob } from './types.js';

export interface ComparisonConfig {
  dbms: DatabaseManagementSystem;
  maxQueueSize: number;
  maxTaskSize: number;
  defaultNode?: string;
  /** Limiar de costEstimate que classifica um job como "de baixo custo". */
  lowCostThreshold?: number;
}

export interface PolicyLatencies {
  firstResultLatencyMs: number | null;
  completionLatencyMs: number | null;
}

export interface ComparisonJobRow {
  jobId: string;
  costEstimate: number;
  lowCost: boolean;
  fairBounded: PolicyLatencies;
  fcfs: PolicyLatencies;
}

export interface LowCostComparison {
  threshold: number;
  count: number;
  fairBoundedAvgCompletionMs: number | null;
  fcfsAvgCompletionMs: number | null;
  /** Redução percentual da latência média de conclusão dos jobs de baixo custo. */
  completionLatencyReductionPct: number | null;
}

export interface ComparisonReport {
  jobs: ComparisonJobRow[];
  fairBounded: {
    waitingQueueEnqueuedCount: number;
    avgCompletionLatencyMs: number | null;
    avgFirstResultLatencyMs: number | null;
  };
  fcfs: {
    avgCompletionLatencyMs: number | null;
    avgFirstResultLatencyMs: number | null;
  };
  lowCost: LowCostComparison;
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Executa a MESMA carga sob duas políticas:
 *  - fair-bounded: BoundedFairScheduler (round-robin + fila limitada + waiting queue);
 *  - FCFS: cada job executa TODAS as suas sub-tarefas até o fim antes do próximo.
 * Ambas usam Clocks manuais independentes começando em 0 → determinismo total.
 */
export function runComparison(jobs: QueryJob[], config: ComparisonConfig): ComparisonReport {
  const threshold = config.lowCostThreshold ?? 100;
  const firstNode = config.dbms.nodeNames()[0];
  if (firstNode === undefined) throw new Error('DBMS sem nós');
  const node = config.defaultNode ?? firstNode;

  // ---- Política fair-bounded ----
  const fairClock = new ManualClock(0);
  const scheduler = new BoundedFairScheduler({
    maxQueueSize: config.maxQueueSize,
    maxTaskSize: config.maxTaskSize,
    clock: fairClock,
    dbms: config.dbms,
    defaultNode: node,
  });
  const fairIds: string[] = [];
  for (const job of jobs) fairIds.push(scheduler.submit(job).jobId);
  scheduler.runUntilIdle();

  // ---- Política FCFS ----
  const fcfsClock = new ManualClock(0);
  const fcfsLat = new Map<string, PolicyLatencies>();
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    if (job === undefined) continue;
    const jobId = fairIds[i] ?? `job-${i + 1}`;
    let after: number | null = null;
    let collected = 0;
    let firstResultLatencyMs: number | null = null;
    for (;;) {
      const base = chooseTaskLimit(job.costEstimate, config.maxTaskSize);
      const limit = Math.min(base, Math.max(1, job.costEstimate - collected));
      const rows = config.dbms.execute(node, { after, limit }, fcfsClock);
      collected += rows.length;
      if (rows.length > 0 && firstResultLatencyMs === null) {
        firstResultLatencyMs = fcfsClock.now();
      }
      const last = rows[rows.length - 1];
      if (last !== undefined) after = last.id;
      if (isChainExhausted(rows.length, limit) || collected >= job.costEstimate) break;
    }
    fcfsLat.set(jobId, {
      firstResultLatencyMs,
      completionLatencyMs: fcfsClock.now(),
    });
  }

  // ---- Consolidação lado a lado ----
  const rows: ComparisonJobRow[] = fairIds.map((jobId, i) => {
    const m = scheduler.getMetrics(jobId);
    const costEstimate = jobs[i]?.costEstimate ?? 0;
    const fcfs = fcfsLat.get(jobId) ?? {
      firstResultLatencyMs: null,
      completionLatencyMs: null,
    };
    return {
      jobId,
      costEstimate,
      lowCost: costEstimate <= threshold,
      fairBounded: {
        firstResultLatencyMs: m?.firstResultLatencyMs ?? null,
        completionLatencyMs: m?.completionLatencyMs ?? null,
      },
      fcfs,
    };
  });

  const lowCostRows = rows.filter((r) => r.lowCost);
  const fairLowAvg = avg(lowCostRows.map((r) => r.fairBounded.completionLatencyMs));
  const fcfsLowAvg = avg(lowCostRows.map((r) => r.fcfs.completionLatencyMs));
  const reductionPct =
    fairLowAvg !== null && fcfsLowAvg !== null && fcfsLowAvg > 0
      ? ((fcfsLowAvg - fairLowAvg) / fcfsLowAvg) * 100
      : null;

  const summary = scheduler.summary();
  return {
    jobs: rows,
    fairBounded: {
      waitingQueueEnqueuedCount: summary.waitingQueueEnqueuedCount,
      avgCompletionLatencyMs: avg(rows.map((r) => r.fairBounded.completionLatencyMs)),
      avgFirstResultLatencyMs: avg(rows.map((r) => r.fairBounded.firstResultLatencyMs)),
    },
    fcfs: {
      avgCompletionLatencyMs: avg(rows.map((r) => r.fcfs.completionLatencyMs)),
      avgFirstResultLatencyMs: avg(rows.map((r) => r.fcfs.firstResultLatencyMs)),
    },
    lowCost: {
      threshold,
      count: lowCostRows.length,
      fairBoundedAvgCompletionMs: fairLowAvg,
      fcfsAvgCompletionMs: fcfsLowAvg,
      completionLatencyReductionPct: reductionPct,
    },
  };
}