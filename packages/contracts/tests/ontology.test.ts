/**
 * contracts — tests/ontology.test.ts
 */
import { describe, expect, it } from 'vitest';

import { assertObjectTypeDef, buildGoldenObjectType } from '../src/v1/ontology.js';

describe('Passo 17 contracts — ontology', () => {
  it('golden ObjectType tem id + propertyTypeIds', () => {
    const ot = buildGoldenObjectType();
    expect(ot.id).toBe('ot.customer');
    expect(ot.propertyTypeIds).toContain('pt.name');
    assertObjectTypeDef(ot);
  });

  it('assertObjectTypeDef rejeita sem id', () => {
    expect(() =>
      assertObjectTypeDef({
        id: '',
        displayName: 'X',
        propertyTypeIds: [],
      }),
    ).toThrow(/id/);
  });
});
