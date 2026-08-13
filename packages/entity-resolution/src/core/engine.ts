/**
 * entity-resolution — src/core/engine.ts
 * Pipeline ER: normalização → blocking → scoring → soft clusters (Passo 20)
 * + audit / canonical / fingerprint / rank (Passo 21).
 *
 * US 8,554,719 / 9,501,552 / 9,846,731 / 12,229,154 / US20140280252
 * US20250165857A1 / US 12,393,406 / US20250348288A1 / US 8,788,405 / US 8,818,892
 */

import {
  assertEntityRecord,
  assertResolutionCriteria,
  buildGoldenClusterScoringStrategy,
  buildGoldenCriteria,
  type CanonicalEntityId,
  type ClusterScoringStrategy,
  type EntityRecord,
  type EntityRecordId,
  type EntityResolutionEngine,
  type FingerprintMatch,
  type MatchAuditId,
  type MatchDecision,
  type MergeCanonicalInput,
  type NormalizedRecord,
  type RecordReviewInput,
  type ResolutionCriteria,
  type ResolutionResult,
  type ResolutionRunId,
  type RunResolutionInput,
  type SoftCluster,
  type UnmergeInput,
} from 'contracts';

import {
  buildBlockIndex,
  enumerateCandidatePairs,
  fullCartesianCount,
} from './blocking.js';
import { buildSoftClusters } from './cluster.js';
import { rankClusters as rankClustersByStrategy } from './cluster-score.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { createMemoryEntityLedger } from './ledger.js';
import { normalizeRecord } from './normalize.js';
import { createPgEntityLedger } from './pg-ledger.js';
import { scorePair } from './scoring.js';
import type { CreateEntityResolverOptions, EntityLedger } from './types.js';

function createLedger(opts: CreateEntityResolverOptions): EntityLedger {
  if (opts.ledger) return opts.ledger;
  if (opts.sql) {
    return createPgEntityLedger({ sql: opts.sql, clock: opts.clock, nextId: opts.nextId });
  }
  return createMemoryEntityLedger({ clock: opts.clock, nextId: opts.nextId });
}

export function createEntityResolver(
  opts: CreateEntityResolverOptions = {},
): EntityResolutionEngine {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const ledger = createLedger({ ...opts, clock, nextId });

  function runResolution(input: RunResolutionInput): ResolutionResult {
    const criteria = input.criteria ?? buildGoldenCriteria();
    assertResolutionCriteria(criteria);
    clock();

    const filtered = input.records.filter((r) => {
      assertEntityRecord(r);
      if (criteria.targetObjectTypeIds?.length) {
        return criteria.targetObjectTypeIds.includes(r.objectTypeId);
      }
      return true;
    });

    const normalized: NormalizedRecord[] = filtered.map(normalizeRecord);

    const index = buildBlockIndex(normalized, opts.bloomBins);
    const pairs = enumerateCandidatePairs(normalized, index);

    const candidates = pairs.map(([left, right, blockKey]) =>
      scorePair(left, right, blockKey, criteria),
    );

    const objectTypeById = new Map(normalized.map((n) => [n.recordId, n.objectTypeId]));
    const displayNameById = new Map(normalized.map((n) => [n.recordId, n.fields.name]));

    const clusters = buildSoftClusters(
      normalized.map((n) => n.recordId),
      objectTypeById,
      displayNameById,
      candidates,
      nextId,
    );

    let matchCount = 0;
    let reviewCount = 0;
    let noMatchCount = 0;
    for (const c of candidates) {
      if (c.decision === 'match') matchCount += 1;
      else if (c.decision === 'review') reviewCount += 1;
      else noMatchCount += 1;
    }

    return {
      runId: nextId('run'),
      ruleVersionId: criteria.ruleVersionId,
      normalized,
      candidates,
      clusters,
      stats: {
        inputCount: input.records.length,
        normalizedCount: normalized.length,
        blockCount: index.byKey.size,
        comparisons: candidates.length,
        fullCartesianPairs: fullCartesianCount(normalized.length),
        matchCount,
        reviewCount,
        noMatchCount,
        clusterCount: clusters.length,
      },
    };
  }

  return {
    getDefaultCriteria(): ResolutionCriteria {
      return buildGoldenCriteria();
    },

    runResolution,

    compareToTargets(
      incoming: EntityRecord,
      targets: EntityRecord[],
      criteria?: ResolutionCriteria,
    ): ResolutionResult {
      return runResolution({
        records: [incoming, ...targets],
        criteria,
      });
    },

    async commitRun(result: ResolutionResult): Promise<ResolutionRunId> {
      const runId = await ledger.commitRun(result);
      const records: EntityRecord[] = result.normalized.map((n) => ({
        id: n.recordId,
        objectTypeId: n.objectTypeId,
        sourceSystem: n.sourceSystem,
        properties: { ...n.fields },
      }));
      await ledger.indexFingerprints(records);
      return runId;
    },

    listMatchAudit(filter?: { runId?: ResolutionRunId; decision?: MatchDecision }) {
      return ledger.listMatchAudit(filter);
    },

    getMatchAudit(id: MatchAuditId) {
      return ledger.getMatchAudit(id);
    },

    recordReview(input: RecordReviewInput) {
      return ledger.recordReview(input);
    },

    mergeCanonical(input: MergeCanonicalInput) {
      return ledger.mergeCanonical(input);
    },

    unmerge(input: UnmergeInput) {
      return ledger.unmerge(input);
    },

    getCanonical(id: CanonicalEntityId) {
      return ledger.getCanonical(id);
    },

    listCanonicals(objectTypeId?: string) {
      return ledger.listCanonicals(objectTypeId);
    },

    linksForRecord(recordId: EntityRecordId) {
      return ledger.linksForRecord(recordId);
    },

    listMergeEvents(canonicalId?: CanonicalEntityId) {
      return ledger.listMergeEvents(canonicalId);
    },

    indexFingerprints(records: EntityRecord[]) {
      return ledger.indexFingerprints(records);
    },

    searchSimilar(query: EntityRecord): Promise<FingerprintMatch[]> {
      return ledger.searchSimilar(query);
    },

    rankClusters(
      clusters: SoftCluster[],
      candidates: ResolutionResult['candidates'],
      strategy?: ClusterScoringStrategy,
    ) {
      return rankClustersByStrategy(
        clusters,
        candidates,
        strategy ?? buildGoldenClusterScoringStrategy(),
      );
    },
  };
}
