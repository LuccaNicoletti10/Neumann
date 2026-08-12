/**
 * transformation-runner — src/core/incremental.ts
 * Análise de computabilidade incremental (FULL / INCREMENTAL + tipos).
 */

import type {
  IncrementalComputability,
  IncrementalStatus,
  TransformStep,
} from 'contracts';

import { getOp } from './ops.js';

export interface IncrementalAnalysis {
  status: IncrementalStatus;
  computability: IncrementalComputability;
  reasons: string[];
}

export function worstComputability(
  a: IncrementalComputability,
  b: IncrementalComputability,
): IncrementalComputability {
  const rank: Record<IncrementalComputability, number> = {
    CONCATENATE: 0,
    MERGE_AND_APPEND: 1,
    MERGE_AND_REPLACE: 2,
    IMPOSSIBLE: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

export function combineStatus(
  a: IncrementalStatus,
  b: IncrementalStatus,
): IncrementalStatus {
  return a === 'FULL' || b === 'FULL' ? 'FULL' : 'INCREMENTAL';
}

export function analyzeIncremental(steps: readonly TransformStep[]): IncrementalAnalysis {
  if (steps.length === 0) {
    return {
      status: 'INCREMENTAL',
      computability: 'CONCATENATE',
      reasons: ['empty pipeline'],
    };
  }

  let status: IncrementalStatus = 'INCREMENTAL';
  let computability: IncrementalComputability = 'CONCATENATE';
  const reasons: string[] = [];

  for (const step of steps) {
    const op = getOp(step.kind);
    status = combineStatus(status, op.defaultStatus);
    computability = worstComputability(computability, op.defaultComputability);
    if (op.defaultComputability === 'IMPOSSIBLE') {
      reasons.push(`${step.kind}: IMPOSSIBLE`);
    }
  }

  return { status, computability, reasons };
}

export function isIncrementalComputationAvailable(
  steps: readonly TransformStep[],
): boolean {
  return analyzeIncremental(steps).computability !== 'IMPOSSIBLE';
}
