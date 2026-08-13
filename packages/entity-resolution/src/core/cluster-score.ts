/**
 * entity-resolution — src/core/cluster-score.ts
 * Cluster scoring / ranking (US 8,818,892) — generic metrics, not fraud/finance.
 * US 8,788,405: clusters remain seed + related members; ranking orders the review queue.
 */

import {
  buildGoldenClusterScoringStrategy,
  type CandidatePair,
  type ClusterScoringStrategy,
  type RankedCluster,
  type SoftCluster,
} from 'contracts';

function pairTouches(c: CandidatePair, memberIds: Set<string>): boolean {
  return memberIds.has(c.leftId) && memberIds.has(c.rightId);
}

function baseScore(
  cluster: SoftCluster,
  candidates: CandidatePair[],
  kind: ClusterScoringStrategy['metrics'][number]['kind'],
): number {
  const members = new Set(cluster.memberIds);
  if (kind === 'member_count') return cluster.memberIds.length;
  const related = candidates.filter((c) => pairTouches(c, members));
  if (kind === 'max_confidence') {
    return related.reduce((m, c) => Math.max(m, c.confidence), 0);
  }
  if (kind === 'review_pair_count') {
    return related.filter((c) => c.decision === 'review').length;
  }
  if (kind === 'match_pair_count') {
    return related.filter((c) => c.decision === 'match').length;
  }
  return 0;
}

export function rankClusters(
  clusters: SoftCluster[],
  candidates: CandidatePair[],
  strategy: ClusterScoringStrategy = buildGoldenClusterScoringStrategy(),
): RankedCluster[] {
  const ranked: RankedCluster[] = clusters.map((cluster) => {
    let score = 0;
    for (const metric of strategy.metrics) {
      score += baseScore(cluster, candidates, metric.kind) * metric.weight;
    }
    return {
      clusterId: cluster.clusterId,
      score,
      seedId: cluster.suggestedCanonicalId,
      memberCount: cluster.memberIds.length,
    };
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.clusterId.localeCompare(b.clusterId);
  });
  return ranked;
}
