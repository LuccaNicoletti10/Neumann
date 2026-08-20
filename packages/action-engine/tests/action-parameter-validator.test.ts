/**
 * action-engine — tests/action-parameter-validator.test.ts
 *
 * Tests for every declared validator in ActionParameterDef.
 * Each test builds a real ActionTypeDef — no reflection or bypass.
 */

import { describe, expect, it } from 'vitest';

import type { ActionTypeDef } from 'contracts';
import {
  compilePattern,
  validateActionParameters,
  validateActionTypeDefSchema,
  validateParameterDef,
} from '../src/core/action-parameter-validator.js';

function defWith(params: ActionTypeDef['parameters']): ActionTypeDef {
  return {
    id: 'act.test',
    apiName: 'test',
    displayName: 'Test',
    inputObjectTypeIds: [],
    parameters: params ?? {},
    rules: [],
  };
}

describe('validateActionParameters — baseType', () => {
  it('accepts correct baseType=string', () => {
    const def = defWith({ name: { baseType: 'string', required: true } });
    expect(validateActionParameters(def, { name: 'Alice' })).toEqual([]);
  });

  it('rejects string sent to number field', () => {
    const def = defWith({ count: { baseType: 'number', required: true } });
    const errs = validateActionParameters(def, { count: 'oops' });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.field).toBe('count');
    expect(errs[0]?.message).toMatch(/number/);
  });

  it('rejects number sent to boolean field', () => {
    const def = defWith({ flag: { baseType: 'boolean', required: true } });
    const errs = validateActionParameters(def, { flag: 42 });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.field).toBe('flag');
  });
});

describe('validateActionParameters — required/nullable', () => {
  it('rejects missing required field', () => {
    const def = defWith({ orderId: { baseType: 'string', required: true } });
    const errs = validateActionParameters(def, {});
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/required/);
  });

  it('accepts missing optional field', () => {
    const def = defWith({ note: { baseType: 'string', required: false } });
    expect(validateActionParameters(def, {})).toEqual([]);
  });

  it('accepts missing nullable field', () => {
    const def = defWith({ tag: { baseType: 'string', required: false, nullable: true } });
    expect(validateActionParameters(def, {})).toEqual([]);
  });

  it('rejects unknown parameter', () => {
    const def = defWith({ name: { baseType: 'string', required: false } });
    const errs = validateActionParameters(def, { name: 'Alice', extra: 'X' });
    expect(errs.some((e) => e.field === 'extra')).toBe(true);
  });
});

describe('validateActionParameters — allowedValues (enum)', () => {
  it('accepts value in allowedValues', () => {
    const def = defWith({ status: { baseType: 'string', required: true, allowedValues: ['pending', 'active'] } });
    expect(validateActionParameters(def, { status: 'active' })).toEqual([]);
  });

  it('rejects value not in allowedValues', () => {
    const def = defWith({ status: { baseType: 'string', required: true, allowedValues: ['pending', 'active'] } });
    const errs = validateActionParameters(def, { status: 'deleted' });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.field).toBe('status');
    expect(errs[0]?.message).toMatch(/one of/);
  });

  it('works with numeric allowedValues', () => {
    const def = defWith({ priority: { baseType: 'number', required: true, allowedValues: [1, 2, 3] } });
    expect(validateActionParameters(def, { priority: 2 })).toEqual([]);
    expect(validateActionParameters(def, { priority: 5 })).toHaveLength(1);
  });
});

describe('validateActionParameters — pattern (regex)', () => {
  it('accepts string matching pattern', () => {
    const def = defWith({ code: { baseType: 'string', required: true, pattern: '^[A-Z]{3}$' } });
    expect(validateActionParameters(def, { code: 'ABC' })).toEqual([]);
  });

  it('rejects string not matching pattern', () => {
    const def = defWith({ code: { baseType: 'string', required: true, pattern: '^[A-Z]{3}$' } });
    const errs = validateActionParameters(def, { code: 'abc' });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.field).toBe('code');
    expect(errs[0]?.message).toMatch(/pattern/);
  });
});

describe('validateActionParameters — min/max', () => {
  it('accepts number within bounds', () => {
    const def = defWith({ qty: { baseType: 'number', required: true, min: 1, max: 100 } });
    expect(validateActionParameters(def, { qty: 50 })).toEqual([]);
  });

  it('rejects number below min', () => {
    const def = defWith({ qty: { baseType: 'number', required: true, min: 1 } });
    const errs = validateActionParameters(def, { qty: 0 });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/>=/);
  });

  it('rejects number above max', () => {
    const def = defWith({ qty: { baseType: 'number', required: true, max: 10 } });
    const errs = validateActionParameters(def, { qty: 11 });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/<=/);
  });

  it('accepts number exactly at boundary', () => {
    const def = defWith({ qty: { baseType: 'number', required: true, min: 1, max: 1 } });
    expect(validateActionParameters(def, { qty: 1 })).toEqual([]);
  });
});

describe('compilePattern', () => {
  it('compiles a valid pattern', () => {
    const re = compilePattern('f', '^[a-z]+$');
    expect(re.test('abc')).toBe(true);
  });

  it('throws on invalid pattern', () => {
    expect(() => compilePattern('f', '[')).toThrow(/invalid pattern/);
  });

  it('throws when pattern exceeds MAX_PATTERN_LENGTH', () => {
    const longPattern = 'a'.repeat(1001);
    expect(() => compilePattern('f', longPattern)).toThrow(/exceeds maximum length/);
  });

  it('rejects nested quantifiers so a pathological pattern never matches', () => {
    expect(() => compilePattern('f', '(a+)+$')).toThrow(/nested quantifiers/);
    const def = defWith({ code: { baseType: 'string', required: true, pattern: '(a+)+$' } });
    const errs = validateActionParameters(def, { code: 'aaaaaaaaaaaaaaaaaaaa!' });
    expect(errs.some((e) => /nested quantifiers|unsafe/.test(e.message))).toBe(true);
  });
});

describe('validateParameterDef', () => {
  it('returns no errors for a valid def', () => {
    expect(validateParameterDef('x', { baseType: 'string', pattern: '^\\d+$' })).toEqual([]);
  });

  it('returns error for invalid pattern', () => {
    const errs = validateParameterDef('x', { baseType: 'string', pattern: '[' });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/invalid pattern/);
  });

  it('returns error for min/max on non-numeric type', () => {
    const errs = validateParameterDef('x', { baseType: 'string', min: 0 });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/only numeric/);
  });

  it('returns error when allowedValues type mismatches baseType', () => {
    const errs = validateParameterDef('x', { baseType: 'number', allowedValues: ['not-a-number'] });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/allowedValues/);
  });

  it('returns no error when allowedValues match baseType', () => {
    const errs = validateParameterDef('x', { baseType: 'number', allowedValues: [1, 2, 3] });
    expect(errs).toEqual([]);
  });
});

describe('validateActionTypeDefSchema', () => {
  it('returns no errors for a valid action', () => {
    const errs = validateActionTypeDefSchema(defWith({ qty: { baseType: 'number', min: 0 } }));
    expect(errs).toEqual([]);
  });

  it('returns errors for invalid parameter defs', () => {
    const errs = validateActionTypeDefSchema(
      defWith({ qty: { baseType: 'string', min: 0 }, code: { baseType: 'string', pattern: '[' } }),
    );
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
});
