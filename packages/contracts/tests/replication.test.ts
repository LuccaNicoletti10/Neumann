/**
 * contracts — tests/replication.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertReplicationMutation,
  buildGoldenOntologyMapSpec,
  buildGoldenReplicationMutation,
  isReplicationOperation,
  REPLICATION_OPERATIONS,
} from '../src/v1/replication.js';

describe('contracts — replication (Passo 33)', () => {
  it('golden mutation tem ACL como policy e vetor', () => {
    const m = buildGoldenReplicationMutation();
    assertReplicationMutation(m);
    expect(m.policy.acl).toBe('public');
    expect(m.version.A).toBe(1);
    expect(m.redacted).toBe(false);
  });

  it('redacted exige payload null', () => {
    const m = { ...buildGoldenReplicationMutation(), redacted: true, payload: 'secret' };
    expect(() => assertReplicationMutation(m)).toThrow(/payload null/);
  });

  it('operations e ontology map golden', () => {
    expect(REPLICATION_OPERATIONS).toContain('acl');
    expect(isReplicationOperation('acl')).toBe(true);
    expect(isReplicationOperation('merge')).toBe(false);
    const spec = buildGoldenOntologyMapSpec();
    expect(spec.objectMappings.Person).toBe('Employee');
    expect(spec.linkReverse).toContain('ParentOf');
  });
});
