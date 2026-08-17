/**
 * entity-resolution — src/core/review-queue.ts
 * Fila da zona cinzenta, ordenada (US 8,818,892).
 */

import type { GoldPair, MatchAuditEntry, ReviewQueueItem } from 'contracts';

import { pairKey } from './pair-key.js';

export function buildReviewQueue(
  audits: MatchAuditEntry[],
  gold: GoldPair[],
): ReviewQueueItem[] {
  const goldByPair = new Map(gold.map((g) => [pairKey(g.leftId, g.rightId), g.label]));
  const items: ReviewQueueItem[] = [];
  for (const a of audits) {
    if (a.decision !== 'review') continue;
    if (a.review && a.review.decision !== 'needs_review') continue;
    items.push({
      auditId: a.id,
      runId: a.runId,
      leftId: a.leftId,
      rightId: a.rightId,
      objectTypeId: a.objectTypeId,
      score: a.score,
      confidence: a.confidence,
      decision: a.decision,
      reason: a.reason,
      rankScore: a.score,
      goldLabel: goldByPair.get(pairKey(a.leftId, a.rightId)),
      review: a.review,
    });
  }
  items.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.auditId.localeCompare(b.auditId);
  });
  return items;
}
