/**
 * object-set — catalog plan inspector (EXPLAIN JSON fixtures, no PostgreSQL).
 */
import { describe, expect, it } from 'vitest';

import {
  inspectCatalogPlan,
  parseExplainJson,
  verdictForCatalogPlan,
} from '../src/core/catalog-plan.js';

const ginIndexes = [
  { name: 'platform_objects_pk_trgm', accessMethod: 'gin' },
  { name: 'platform_objects_props_fts', accessMethod: 'gin' },
  { name: 'platform_objects_pkey', accessMethod: 'btree' },
];

const ginPlan = [
  {
    Plan: {
      'Node Type': 'Limit',
      Plans: [
        {
          'Node Type': 'Bitmap Heap Scan',
          'Relation Name': 'platform_objects',
          Plans: [
            {
              'Node Type': 'BitmapOr',
              Plans: [
                {
                  'Node Type': 'Bitmap Index Scan',
                  'Index Name': 'platform_objects_pk_trgm',
                },
                {
                  'Node Type': 'Bitmap Index Scan',
                  'Index Name': 'platform_objects_props_fts',
                },
              ],
            },
          ],
        },
      ],
    },
  },
];

const btreePlan = [
  {
    Plan: {
      'Node Type': 'Index Scan',
      'Index Name': 'platform_objects_pkey',
      'Relation Name': 'platform_objects',
    },
  },
];

const seqPlan = [
  {
    Plan: {
      'Node Type': 'Seq Scan',
      'Relation Name': 'platform_objects',
    },
  },
];

describe('inspectCatalogPlan', () => {
  it('positive: Bitmap Index Scan on GIN names is usedGin', () => {
    const inspection = inspectCatalogPlan(ginPlan);
    expect(inspection.indexNames).toEqual([
      'platform_objects_pk_trgm',
      'platform_objects_props_fts',
    ]);
    expect(inspection.nodeTypes).toContain('Bitmap Index Scan');
    const verdict = verdictForCatalogPlan(inspection, ginIndexes);
    expect(verdict.usedGin).toBe(true);
    expect(verdict.sequentialScan).toBe(false);
    expect(verdict.ginIndexesUsed).toEqual([
      'platform_objects_pk_trgm',
      'platform_objects_props_fts',
    ]);
  });

  it('negative: btree primary key is not GIN', () => {
    const inspection = inspectCatalogPlan(btreePlan);
    const verdict = verdictForCatalogPlan(inspection, ginIndexes);
    expect(verdict.usedGin).toBe(false);
    expect(verdict.usedIndex).toBe(true);
    expect(verdict.otherIndexesUsed).toEqual(['platform_objects_pkey']);
    expect(verdict.sequentialScan).toBe(false);
  });

  it('negative: Seq Scan is not an index plan', () => {
    const inspection = inspectCatalogPlan(seqPlan);
    const verdict = verdictForCatalogPlan(inspection, ginIndexes);
    expect(verdict.usedGin).toBe(false);
    expect(verdict.usedIndex).toBe(false);
    expect(verdict.sequentialScan).toBe(true);
  });

  it('rejects JSON without a Plan node', () => {
    expect(() => parseExplainJson({ not: 'a plan' })).toThrow(/Plan node/);
  });
});
