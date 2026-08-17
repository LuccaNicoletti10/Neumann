/**
 * contracts — tests/federation.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertPushdownSpec,
  assertTemporaryObject,
  buildGoldenPushdownSpec,
  buildGoldenTemporaryObject,
  isPlatformObject,
  isTemporaryObject,
} from '../src/v1/federation.js';

describe('contracts — federation (Passo 31)', () => {
  it('golden pushdown tem PK e predicado', () => {
    const spec = buildGoldenPushdownSpec();
    expect(spec.primaryKeys).toEqual(['P-778']);
    expect(spec.predicates?.[0]?.op).toBe('eq');
    assertPushdownSpec(spec);
  });

  it('golden temporary object é copy-on-write federado', () => {
    const obj = buildGoldenTemporaryObject();
    assertTemporaryObject(obj);
    expect(isTemporaryObject(obj)).toBe(true);
    expect(isPlatformObject(obj)).toBe(false);
    expect(obj.provenance).toBe('federated');
    expect(obj.copyOnWrite).toBe(true);
  });

  it('assertPushdownSpec rejeita object vazio', () => {
    expect(() =>
      assertPushdownSpec({ object: { sourceSystem: '', objectName: '' } }),
    ).toThrow(/object/);
  });
});
