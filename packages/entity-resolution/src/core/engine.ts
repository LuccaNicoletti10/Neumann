/**
 * entity-resolution — src/core/engine.ts
 * Pipeline ER: normalização → blocking → scoring → soft clusters.
 *
 * US 8,554,719 / 9,501,552 / 9,846,731 / 12,229,154 / US20140280252
 */

import {
  assertEntityRecord,
  assertResolutionCriteria,
  buildGoldenCriteria,
  type EntityResolutionEngine,
  type NormalizedRecord,
  type ResolutionCriteria,
  type ResolutionResult,
  type RunResolutionInput,
} from 'contracts';

import {
  buildBlockIndex,
  enumerateCandidatePairs,
  fullCartesianCount,
} from './blocking.js';
import { buildSoftClusters } from './cluster.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { normalizeRecord } from './normalize.js';
import { scorePair } from './scoring.js';
import type { CreateEntityResolverOptions } from './types.js';

export function createEntityResolver(
  opts: CreateEntityResolverOptions = {},
): EntityResolutionEngine {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();

  return {
    getDefaultCriteria(): ResolutionCriteria {
      return buildGoldenCriteria();
    },

    runResolution(input: RunResolutionInput): ResolutionResult {
      const criteria = input.criteria ?? buildGoldenCriteria();
      assertResolutionCriteria(criteria);
      clock(); // tick para run determinístico ter instante

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
    },
  };
}
