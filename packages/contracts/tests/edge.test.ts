/**
 * contracts — tests/edge.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertActivityUnit,
  buildGoldenActivityUnit,
  EDGE_SOURCE_KINDS,
  isEdgeSourceKind,
} from '../src/v1/edge.js';

describe('contracts — edge (Passo 32)', () => {
  it('golden activity unit tem tempo + action + operator', () => {
    const u = buildGoldenActivityUnit();
    assertActivityUnit(u);
    expect(u.actionType).toBe('view');
    expect(u.operatorId).toBe('op-1');
  });

  it('EdgeSourceKind cobre a lista das patentes', () => {
    expect(EDGE_SOURCE_KINDS).toContain('sslCertificateAuthority');
    expect(EDGE_SOURCE_KINDS).toContain('programmableLogicController');
    expect(isEdgeSourceKind('packetLog')).toBe(true);
    expect(isEdgeSourceKind('salesOrder')).toBe(false);
  });
});
