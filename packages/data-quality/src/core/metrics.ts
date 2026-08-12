/**
 * data-quality — src/core/metrics.ts
 * Dimensões: completeness, uniqueness, validity, consistency, freshness, drift.
 */

import type { QualityScore } from 'contracts';

import type { NamedDataset, Row } from './types.js';

export interface MetricsOptions {
  /** Colunas consideradas para validity (regex/type heurística simples). */
  validityColumns?: Array<{ column: string; type: 'string' | 'number' | 'boolean' }>;
  /** Pares columnA === columnB para consistency. */
  consistencyPairs?: Array<{ left: string; right: string }>;
  /** Agora ISO para freshness. */
  now: string;
  /** Max age em segundos para freshness score=1. */
  freshnessMaxAgeSeconds?: number;
}

export function scoreDataset(ds: NamedDataset, opts: MetricsOptions): QualityScore[] {
  const rows = ds.rows;
  const n = rows.length;
  const scores: QualityScore[] = [];

  // completeness: fraction of non-null cells across all columns
  if (n === 0 || ds.columns.length === 0) {
    scores.push({ dimension: 'completeness', score: 1, detail: 'empty' });
  } else {
    let filled = 0;
    let total = 0;
    for (const row of rows) {
      for (const c of ds.columns) {
        total += 1;
        if (row[c] !== null && row[c] !== undefined && row[c] !== '') filled += 1;
      }
    }
    scores.push({
      dimension: 'completeness',
      score: total === 0 ? 1 : filled / total,
      detail: `${filled}/${total}`,
    });
  }

  // uniqueness: average unique ratio per column
  if (n === 0) {
    scores.push({ dimension: 'uniqueness', score: 1, detail: 'empty' });
  } else {
    let sum = 0;
    for (const c of ds.columns) {
      const set = new Set(rows.map((r) => String(r[c])));
      sum += set.size / n;
    }
    scores.push({
      dimension: 'uniqueness',
      score: ds.columns.length === 0 ? 1 : sum / ds.columns.length,
    });
  }

  // validity
  const validityCols = opts.validityColumns ?? [];
  if (validityCols.length === 0 || n === 0) {
    scores.push({ dimension: 'validity', score: 1, detail: 'no checks' });
  } else {
    let ok = 0;
    let total = 0;
    for (const row of rows) {
      for (const v of validityCols) {
        total += 1;
        if (matchesType(row[v.column], v.type)) ok += 1;
      }
    }
    scores.push({
      dimension: 'validity',
      score: total === 0 ? 1 : ok / total,
      detail: `${ok}/${total}`,
    });
  }

  // consistency
  const pairs = opts.consistencyPairs ?? [];
  if (pairs.length === 0 || n === 0) {
    scores.push({ dimension: 'consistency', score: 1, detail: 'no pairs' });
  } else {
    let ok = 0;
    let total = 0;
    for (const row of rows) {
      for (const p of pairs) {
        total += 1;
        if (String(row[p.left]) === String(row[p.right])) ok += 1;
      }
    }
    scores.push({
      dimension: 'consistency',
      score: total === 0 ? 1 : ok / total,
    });
  }

  // freshness
  const maxAge = opts.freshnessMaxAgeSeconds ?? 86400;
  const updated = Date.parse(ds.updatedAt);
  const now = Date.parse(opts.now);
  const ageSec = Number.isFinite(updated) && Number.isFinite(now)
    ? Math.max(0, (now - updated) / 1000)
    : 0;
  const freshScore = ageSec <= maxAge ? 1 - ageSec / (maxAge * 2) : Math.max(0, 1 - ageSec / maxAge);
  scores.push({
    dimension: 'freshness',
    score: Math.min(1, Math.max(0, freshScore)),
    detail: `ageSec=${ageSec}`,
  });

  // drift: compare current categorical distribution of first string-ish column vs previous
  const distCol = ds.columns[0];
  if (!distCol || n === 0) {
    scores.push({ dimension: 'drift', score: 1, detail: 'no baseline' });
  } else {
    const current = distribution(rows, distCol);
    const prev = ds.previousDistribution ?? current;
    const drift = totalVariationDistance(current, prev);
    scores.push({
      dimension: 'drift',
      score: Math.max(0, 1 - drift),
      detail: `tvd=${drift.toFixed(4)}`,
    });
  }

  return scores;
}

function matchesType(value: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  if (value === null || value === undefined) return false;
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
  }
}

export function distribution(rows: readonly Row[], column: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const k = String(row[column] ?? '');
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const total = rows.length || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    out[k] = v / total;
  }
  return out;
}

function totalVariationDistance(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) {
    sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  }
  return sum / 2;
}

export function overallScore(scores: readonly QualityScore[]): number {
  if (scores.length === 0) return 1;
  return scores.reduce((s, x) => s + x.score, 0) / scores.length;
}
