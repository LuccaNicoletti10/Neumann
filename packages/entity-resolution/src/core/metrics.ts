/**
 * entity-resolution — src/core/metrics.ts
 * precision / recall / F1 / false-merge-rate / false-split-rate / manual-review-rate.
 */

import type { CandidatePair, ErMetrics, GoldPair, MatchAuditEntry, MatchDecision } from 'contracts';

import { pairKey } from './pair-key.js';

export interface MetricPrediction {
  leftId: string;
  rightId: string;
  decision: MatchDecision;
}

const FALSE_MERGE_WARN = 0.05;

function ratio(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

export function predictionsFromAudit(rows: MatchAuditEntry[]): MetricPrediction[] {
  return rows.map((r) => ({ leftId: r.leftId, rightId: r.rightId, decision: r.decision }));
}

export function predictionsFromCandidates(rows: CandidatePair[]): MetricPrediction[] {
  return rows.map((r) => ({ leftId: r.leftId, rightId: r.rightId, decision: r.decision }));
}

/**
 * Gold MATCH + pred match = TP; gold NO_MATCH + pred match = FP (false merge).
 * Gold MATCH + pred no_match/ausente = FN (false split).
 * Zona cinzenta (review) não entra em P/R — conta em manual-review-rate.
 */
export function computeMetrics(gold: GoldPair[], predictions: MetricPrediction[]): ErMetrics {
  const pred = new Map<string, MatchDecision>();
  for (const p of predictions) {
    pred.set(pairKey(p.leftId, p.rightId), p.decision);
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let greyZoneCount = 0;

  for (const g of gold) {
    const decision = pred.get(pairKey(g.leftId, g.rightId)) ?? 'no_match';
    if (decision === 'review') {
      greyZoneCount += 1;
      continue;
    }
    const predictedMatch = decision === 'match';
    if (g.label === 'MATCH' && predictedMatch) tp += 1;
    else if (g.label === 'NO_MATCH' && predictedMatch) fp += 1;
    else if (g.label === 'MATCH' && !predictedMatch) fn += 1;
    else tn += 1;
  }

  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const falseMergeRate = ratio(fp, fp + tn);
  const falseSplitRate = ratio(fn, fn + tp);
  const manualReviewRate = ratio(greyZoneCount, gold.length);
  const falseMergeContaminatesGraph = falseMergeRate > FALSE_MERGE_WARN;

  const falseMergeNote = falseMergeContaminatesGraph
    ? `false-merge-rate=${falseMergeRate.toFixed(4)} — ALTO: merges errados contaminam o grafo`
    : `false-merge-rate=${falseMergeRate.toFixed(4)} — grafo não contaminado`;

  return {
    precision,
    recall,
    f1,
    falseMergeRate,
    falseSplitRate,
    manualReviewRate,
    tp,
    fp,
    fn,
    tn,
    goldPairCount: gold.length,
    greyZoneCount,
    falseMergeContaminatesGraph,
    falseMergeNote,
  };
}
