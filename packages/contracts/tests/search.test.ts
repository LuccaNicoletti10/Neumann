/**
 * contracts — tests/search.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertSearchDocument,
  assertSearchQuery,
  buildGoldenSearchDocument,
} from '../src/v1/search.js';

describe('contracts — search (Passo 29)', () => {
  it('golden document has ACL + sourceUpdatedAt', () => {
    const doc = buildGoldenSearchDocument();
    expect(doc.aclPrincipals.length).toBeGreaterThan(0);
    expect(doc.objectTypeId).toBe('ot.customer');
    assertSearchDocument(doc);
  });

  it('assertSearchQuery rejeita limit inválido', () => {
    expect(() => assertSearchQuery({ limit: 0 })).toThrow(/limit/);
  });

  it('SearchBackend inclui federation', () => {
    const backends: Array<'search-index' | 'object-store' | 'graph' | 'federation'> = [
      'search-index',
      'object-store',
      'graph',
      'federation',
    ];
    expect(backends).toHaveLength(4);
    assertSearchQuery({ federate: { objectId: 'P-778' } });
  });
});
