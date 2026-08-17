/**
 * entity-resolution — src/core/feedback.ts
 * US20250165857A1 — feedback humano recalibra criteria (sem sklearn).
 */

import type {
  ApplyFeedbackResult,
  GoldPair,
  MatchAuditEntry,
  ResolutionCriteria,
} from 'contracts';

import { pairKey } from './pair-key.js';

const WEIGHT_STEP = 0.05;
const THRESHOLD_STEP = 0.02;
const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 2;

function cloneCriteria(c: ResolutionCriteria): ResolutionCriteria {
  return {
    ...c,
    linkingTerms: c.linkingTerms.map((t) => ({ ...t })),
    targetObjectTypeIds: c.targetObjectTypeIds ? [...c.targetObjectTypeIds] : undefined,
    thresholds: { ...c.thresholds },
  };
}

export function nextRuleVersion(id: string): string {
  const m = /^(.*)\.fb(\d+)$/.exec(id);
  if (m) return `${m[1]}.fb${Number(m[2]) + 1}`;
  return `${id}.fb1`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * MATCH previsto como no_match/review → sobe peso das features que sinalizaram.
 * NO_MATCH previsto como match (false merge) → desce esses pesos e sobe o limiar match.
 */
export function calibrateCriteria(
  current: ResolutionCriteria,
  gold: GoldPair[],
  audits: MatchAuditEntry[],
): ApplyFeedbackResult {
  const previous = cloneCriteria(current);
  const next = cloneCriteria(current);
  const auditByPair = new Map(audits.map((a) => [pairKey(a.leftId, a.rightId), a]));
  const adjusted = new Set<string>();
  let falseMerges = 0;
  let falseSplits = 0;

  for (const g of gold) {
    const audit = auditByPair.get(pairKey(g.leftId, g.rightId));
    if (!audit) {
      if (g.label === 'MATCH') falseSplits += 1;
      continue;
    }
    const scores = audit.features.propertyScores;
    if (g.label === 'MATCH' && audit.decision !== 'match') {
      falseSplits += 1;
      for (const term of next.linkingTerms) {
        const s = scores[String(term.property)] ?? 0;
        if (s > 0.5) {
          term.weight = clamp(term.weight + WEIGHT_STEP, WEIGHT_MIN, WEIGHT_MAX);
          adjusted.add(String(term.property));
        }
      }
    }
    if (g.label === 'NO_MATCH' && audit.decision === 'match') {
      falseMerges += 1;
      for (const term of next.linkingTerms) {
        const s = scores[String(term.property)] ?? 0;
        if (s > 0.5) {
          term.weight = clamp(term.weight - WEIGHT_STEP, WEIGHT_MIN, WEIGHT_MAX);
          adjusted.add(String(term.property));
        }
      }
    }
  }

  if (falseMerges > 0) {
    next.thresholds.match = clamp(next.thresholds.match + THRESHOLD_STEP, 0.2, 0.95);
  }
  if (falseSplits > 0) {
    next.thresholds.noMatch = clamp(next.thresholds.noMatch - THRESHOLD_STEP, 0.05, 0.7);
  }
  if (!(next.thresholds.match > next.thresholds.noMatch + 0.05)) {
    next.thresholds.match = clamp(next.thresholds.noMatch + 0.1, 0.2, 0.95);
  }

  if (adjusted.size > 0 || falseMerges > 0 || falseSplits > 0) {
    next.ruleVersionId = nextRuleVersion(previous.ruleVersionId);
  }

  return {
    previous,
    next,
    adjustedTerms: [...adjusted].sort(),
    goldPairCount: gold.length,
  };
}
