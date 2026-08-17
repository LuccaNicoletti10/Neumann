/**
 * contracts — tests/graph-redaction.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertRedactionRequest,
  assertSanitizedGraph,
  buildGoldenRedactionCriterion,
} from '../src/v1/graph-redaction.js';

describe('Passo 27 contracts — graph redaction', () => {
  it('golden criterion is property_type email', () => {
    const c = buildGoldenRedactionCriterion();
    expect(c.kind).toBe('property_type');
    expect(c.values).toEqual(['email']);
  });

  it('assertSanitizedGraph detects dangling edges', () => {
    const broken = assertSanitizedGraph({
      viewingLevel: 'Unclassified',
      nodes: [{ id: 'a', objectTypeId: 'ot.x', primaryKey: 'A' }],
      links: [
        {
          id: 'l1',
          linkTypeId: 'lt.x',
          sourceObjectId: 'a',
          targetObjectId: 'missing',
          mappingVersionId: 'mv1',
        },
      ],
      redactedNodeIds: ['missing'],
      redactedLinkIds: [],
      redactedProperties: [],
    });
    expect(broken.ok).toBe(false);
    expect(broken.issues.some((i) => i.kind === 'dangling_target')).toBe(true);
  });

  it('assertRedactionRequest exige viewingLevel', () => {
    expect(() => assertRedactionRequest({ viewingLevel: '' })).toThrow(/viewingLevel/);
  });
});
