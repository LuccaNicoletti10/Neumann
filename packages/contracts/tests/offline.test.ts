/**
 * contracts — tests/offline.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertReplicaObject,
  buildGoldenReplicaObject,
  buildGoldenVersionVector,
  canonicalAuthorizedState,
  DATA_CONFLICT_TYPES,
  GEOTIME_SUB_TYPES,
  isDataConflictType,
  TITLE_SUB_TYPES,
} from '../src/v1/offline.js';

describe('contracts — offline (Passo 34)', () => {
  it('golden replica object é serializável e visível ao principal', () => {
    const obj = buildGoldenReplicaObject();
    assertReplicaObject(obj);
    expect(obj.aclPrincipals).toContain('bob');
    const state = canonicalAuthorizedState([obj], 'bob');
    expect(state).toContain('Ada Lovelace');
    expect(canonicalAuthorizedState([obj], 'carol')).toBe('[]');
  });

  it('authorized_state é estável (chaves ordenadas)', () => {
    const a = buildGoldenReplicaObject();
    const b = buildGoldenReplicaObject();
    b.properties = { city: 'London' };
    b.version = buildGoldenVersionVector();
    expect(canonicalAuthorizedState([a], 'alice')).toBe(canonicalAuthorizedState([b], 'alice'));
  });

  it('catálogo de conflitos cobre os tipos da patente', () => {
    expect(DATA_CONFLICT_TYPES).toContain('geotime');
    expect(DATA_CONFLICT_TYPES).toContain('deletion');
    expect(TITLE_SUB_TYPES).toContain('dissimilarTitles');
    expect(GEOTIME_SUB_TYPES).toHaveLength(9);
    expect(isDataConflictType('title')).toBe(true);
    expect(isDataConflictType('sku')).toBe(false);
  });
});
