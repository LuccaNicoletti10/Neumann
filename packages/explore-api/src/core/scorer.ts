/**
 * explore-api — src/core/scorer.ts
 * Scoring ponderado de objetos (US 9,639,580) — sem mapa/geo/GUI.
 */

import type {
  ExploreMetric,
  ExploreMetricSelection,
  ExploreObjectScore,
  ExploreScoreResult,
  ObjectRecord,
} from 'contracts';
import type { OntologyAuthorizer } from 'policy-engine';

export type MetricScoreFn = (values: Record<string, number>) => number;

export interface RegisteredMetric extends ExploreMetric {
  score: MetricScoreFn;
}

function num(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return 0;
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function linearScale(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return clampScore(((value - min) / (max - min)) * 100);
}

export function computeObjectScores(
  objects: readonly ObjectRecord[],
  metrics: readonly RegisteredMetric[],
  selections: readonly ExploreMetricSelection[],
  principal: string,
  authorizer?: OntologyAuthorizer,
): ExploreScoreResult {
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const visible = objects.filter((o) => {
    if (o.deleted) return false;
    if (authorizer && !authorizer.canReadObjectType(principal, o.objectTypeId, o.ontologyId)) {
      return false;
    }
    return true;
  });

  const rows: ExploreObjectScore[] = [];
  for (const obj of visible) {
    const cell: ExploreObjectScore['metrics'] = {};
    let totalUnweighted = 0;
    let totalWeighted = 0;
    for (const sel of selections) {
      const metric = metricById.get(sel.metricId);
      if (!metric) continue;
      const values: Record<string, number> = {};
      for (const field of metric.sourceFields) {
        values[field] = num(obj.properties[field]);
      }
      const rawValue = clampScore(metric.score(values));
      const weightedValue = rawValue * (sel.weight / 100);
      cell[sel.metricId] = { rawValue, weightedValue };
      totalUnweighted += rawValue;
      totalWeighted += weightedValue;
    }
    rows.push({
      objectId: obj.id,
      primaryKey: obj.primaryKey,
      objectTypeId: obj.objectTypeId,
      metrics: cell,
      totalUnweighted,
      totalWeighted,
      rank: 0,
    });
  }

  rows.sort((a, b) => b.totalWeighted - a.totalWeighted);
  for (let i = 0; i < rows.length; i += 1) {
    rows[i]!.rank = i + 1;
  }
  return { scores: rows };
}

export function updateWeight(
  current: ExploreScoreResult,
  selections: readonly ExploreMetricSelection[],
  metricId: string,
  weight: number,
  objects: readonly ObjectRecord[],
  metrics: readonly RegisteredMetric[],
  principal: string,
  authorizer?: OntologyAuthorizer,
): { selections: ExploreMetricSelection[]; result: ExploreScoreResult } {
  const next = selections.map((s) => (s.metricId === metricId ? { ...s, weight } : s));
  void current;
  return {
    selections: next,
    result: computeObjectScores(objects, metrics, next, principal, authorizer),
  };
}
