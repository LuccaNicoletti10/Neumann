/**
 * contracts — tests/explore.test.ts
 */
import { describe, expect, it } from 'vitest';

import { assertGraphPattern, buildGoldenGraphPattern } from '../src/v1/explore.js';

describe('contracts — explore (Passo 30)', () => {
  it('golden GraphPattern tem root + aresta', () => {
    const p = buildGoldenGraphPattern();
    expect(p.rootNodeId).toBe('c');
    expect(p.edges[0]?.linkTypeId).toBe('lt.placed');
    assertGraphPattern(p);
  });

  it('assertGraphPattern rejeita root ausente', () => {
    expect(() =>
      assertGraphPattern({ rootNodeId: 'x', nodes: [{ id: 'c', objectTypeId: 'ot.customer' }], edges: [] }),
    ).toThrow(/rootNodeId/);
  });
});
