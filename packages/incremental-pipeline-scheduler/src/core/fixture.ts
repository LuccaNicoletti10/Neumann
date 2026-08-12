/**
 * incremental-pipeline-scheduler — src/core/fixture.ts
 * Grafo FIGURA 2B da patente (R1–R4, D1–D6).
 */

import type { IncrementalPipelineScheduler } from './scheduler.js';

/** Monta o DAG de exemplo da patente e retorna ids por nome. */
export function seedPatentFigure2b(sched: IncrementalPipelineScheduler): Record<string, string> {
  const ids: Record<string, string> = {};

  for (const name of ['R1', 'R2', 'R3', 'R4']) {
    const n = sched.addDataset({ id: name, name, kind: 'RAW' });
    ids[name] = n.id;
  }
  for (const name of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) {
    const n = sched.addDataset({ id: name, name, kind: 'DERIVED' });
    ids[name] = n.id;
  }

  // D1←R1, D2←R3, D3←R4, D4←D1+D2, D5←D3, D6←D4+D5
  const edges: [string, string][] = [
    ['R1', 'D1'],
    ['R3', 'D2'],
    ['R4', 'D3'],
    ['D1', 'D4'],
    ['D2', 'D4'],
    ['D3', 'D5'],
    ['D4', 'D6'],
    ['D5', 'D6'],
  ];
  for (const [s, t] of edges) {
    sched.addEdge({ sourceId: s, targetId: t, kind: 'DIRECT' });
  }

  return ids;
}
