/**
 * contracts — tests/column-lineage.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertColumnLineageEdge,
  assertColumnRef,
  buildGoldenColumnLineageEdge,
  columnRefKey,
  parseColumnRefKey,
} from '../src/v1/column-lineage.js';

describe('Passo 27 contracts — column lineage', () => {
  it('golden edge: customers.email → orders-enriched.customer_email', () => {
    const edge = buildGoldenColumnLineageEdge();
    expect(edge.source).toEqual({ versionId: 'customers-v1', column: 'email' });
    expect(edge.target.column).toBe('customer_email');
    assertColumnLineageEdge(edge);
  });

  it('columnRefKey round-trip', () => {
    const ref = { versionId: 'v1', column: 'customer_email' };
    expect(parseColumnRefKey(columnRefKey(ref))).toEqual(ref);
    expect(() => assertColumnRef({ versionId: '', column: 'x' })).toThrow(/versionId/);
  });
});
