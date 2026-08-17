/**
 * contracts — tests/function-runtime.test.ts
 */
import { describe, expect, it } from 'vitest';

import { assertFunctionDef, buildGoldenFunctionDef } from '../src/v1/function-runtime.js';

describe('Passo 23 contracts — function-runtime', () => {
  it('golden FunctionDef é pura e versionada', () => {
    const d = buildGoldenFunctionDef();
    expect(d.pure).toBe(true);
    expect(d.apiName).toBe('scoreRecord');
    expect(d.version).toBe('1');
    assertFunctionDef(d);
  });

  it('assertFunctionDef rejeita impure / sem version', () => {
    expect(() =>
      assertFunctionDef({
        ...buildGoldenFunctionDef(),
        version: '',
      }),
    ).toThrow(/version/);
    expect(() =>
      assertFunctionDef({
        ...buildGoldenFunctionDef(),
        pure: true,
        apiName: '',
      }),
    ).toThrow(/apiName/);
  });
});
