/**
 * contracts — tests/entity-resolution.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertEntityRecord,
  assertResolutionCriteria,
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
