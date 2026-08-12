/**
 * contracts — tests/knowledge-graph.test.ts
 */
import { describe, expect, it } from 'vitest';

import { assertTypedLink, buildGoldenTypedLink } from '../src/v1/knowledge-graph.js';

describe('Passo 19 contracts — knowledge-graph', () => {
  it('golden TypedLink tem source/target + linkType', () => {
    const l = buildGoldenTypedLink();
    expect(l.linkTypeId).toBe('lt.customer_of');
    expect(l.sourceObjectId).toBe('obj-child');
    assertTypedLink(l);
  });

  it('assertTypedLink rejeita sem mappingVersionId', () => {
    expect(() =>
      assertTypedLink({
        id: 'l1',
        linkTypeId: 'lt.x',
        sourceObjectId: 'a',
        targetObjectId: 'b',
        mappingVersionId: '',
      }),
    ).toThrow(/mappingVersionId/);
  });
});
