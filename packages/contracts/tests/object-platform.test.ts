/**
 * contracts — tests/object-platform.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertMappingVersion,
  buildGoldenPropertyMapping,
} from '../src/v1/object-platform.js';

describe('Passo 18 contracts — object-platform', () => {
  it('golden PropertyMapping tem sourceField + propertyTypeId', () => {
    const m = buildGoldenPropertyMapping();
    expect(m.sourceField).toBe('customer_name');
    expect(m.propertyTypeId).toBe('pt.name');
  });

  it('assertMappingVersion rejeita sem PK', () => {
    expect(() =>
      assertMappingVersion({
        id: 'mv-1',
        mappingId: 'm-1',
        versionNumber: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 't',
        contentHash: 'x',
        status: 'COMMITTED',
        datasetId: 'ds-1',
        ontologyVersionId: 'ov-1',
        objectTypeId: 'ot.customer',
        primaryKeyFields: [],
        propertyMappings: [],
        linkMappings: [],
      }),
    ).toThrow(/primaryKeyFields/);
  });
});
