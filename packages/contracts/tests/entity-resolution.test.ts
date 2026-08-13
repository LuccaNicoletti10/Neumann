/**
 * contracts — tests/entity-resolution.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertCanonicalEntity,
  assertEntityRecord,
  assertMatchAuditEntry,
  assertResolutionCriteria,
  buildGoldenClusterScoringStrategy,
  buildGoldenCriteria,
  buildGoldenEntityRecord,
} from '../src/v1/entity-resolution.js';

describe('Passo 20 contracts — entity-resolution', () => {
  it('golden EntityRecord é Customer ACME', () => {
    const r = buildGoldenEntityRecord();
    expect(r.objectTypeId).toBe('ot.customer');
    expect(r.properties.name).toBe('ACME LTDA');
    assertEntityRecord(r);
  });

  it('golden criteria tem thresholds match > noMatch', () => {
    const c = buildGoldenCriteria();
    expect(c.thresholds.match).toBeGreaterThan(c.thresholds.noMatch);
    assertResolutionCriteria(c);
  });

  it('assertEntityRecord rejeita sem objectTypeId', () => {
    expect(() =>
      assertEntityRecord({
        id: 'x',
        objectTypeId: '',
        properties: {},
      }),
    ).toThrow(/objectTypeId/);
  });

  it('assertResolutionCriteria rejeita thresholds inválidos', () => {
    expect(() =>
      assertResolutionCriteria({
        ruleVersionId: 'r1',
        linkingTerms: [{ property: 'name', technique: 'fuzzy_match', weight: 1 }],
        thresholds: { match: 0.2, noMatch: 0.5 },
      }),
    ).toThrow(/thresholds/);
  });
});

describe('Passo 21 contracts — audit + canonical', () => {
  it('golden cluster scoring strategy tem pesos positivos', () => {
    const s = buildGoldenClusterScoringStrategy();
    expect(s.id).toBe('review_priority_v1');
    expect(s.metrics.every((m) => m.weight > 0)).toBe(true);
  });

  it('assertMatchAuditEntry / assertCanonicalEntity rejeitam vazios', () => {
    expect(() =>
      assertMatchAuditEntry({
        id: '',
        runId: 'r',
        leftId: 'a',
        rightId: 'b',
        objectTypeId: 'ot.customer',
        blockKey: 'k',
        score: 1,
        confidence: 1,
        features: { sharedExactKeys: [], propertyScores: {} },
        modelVersion: 'v1',
        decision: 'match',
        reason: 'x',
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
    ).toThrow(/id/);
    expect(() =>
      assertCanonicalEntity({
        id: 'c1',
        objectTypeId: 'ot.customer',
        memberIds: [],
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    ).toThrow(/memberIds/);
  });
});
