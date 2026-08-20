/**
 * contracts — tests/action-parameter-schema.test.ts
 *
 * Linear-safe pattern subset + shared ActionTypeDef schema gate.
 */
import { describe, expect, it } from 'vitest';

import type { ActionTypeDef } from '../src/v1/ontology.js';
import {
  compilePattern,
  hasNestedQuantifiers,
  validateActionTypeDefSchema,
  validateParameterDef,
} from '../src/v1/action-parameter-schema.js';

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

describe('hasNestedQuantifiers', () => {
  it('detects textbook nested quantifiers', () => {
    expect(hasNestedQuantifiers('(a+)+')).toBe(true);
    expect(hasNestedQuantifiers('(a*)*')).toBe(true);
    expect(hasNestedQuantifiers('(a+)*')).toBe(true);
    expect(hasNestedQuantifiers('(a+)+$')).toBe(true);
    expect(hasNestedQuantifiers('([a-z]+)*')).toBe(true);
  });

  it('allows linear patterns used in ontologies', () => {
    expect(hasNestedQuantifiers('^[A-Z]{3}$')).toBe(false);
    expect(hasNestedQuantifiers('^\\d+$')).toBe(false);
    expect(hasNestedQuantifiers('^[^@]+@[^@]+$')).toBe(false);
    expect(hasNestedQuantifiers('(ab)+')).toBe(false);
    expect(hasNestedQuantifiers('a+b+')).toBe(false);
    expect(hasNestedQuantifiers('[a+]+')).toBe(false);
  });
});

describe('compilePattern — linear-safe subset', () => {
  it('compiles a valid linear pattern', () => {
    const re = compilePattern('f', '^[a-z]+$');
    expect(re.test('abc')).toBe(true);
    expect(re.test('ABC')).toBe(false);
  });

  it('throws on invalid syntax', () => {
    expect(() => compilePattern('f', '[')).toThrow(/invalid pattern/);
  });

  it('throws when pattern exceeds MAX_PATTERN_LENGTH', () => {
    expect(() => compilePattern('f', 'a'.repeat(1001))).toThrow(/exceeds maximum length/);
  });

  it('rejects a short pathological nested-quantifier pattern without executing it', () => {
    expect(() => compilePattern('code', '(a+)+$')).toThrow(/nested quantifiers/);
  });

  it('rejects backreferences', () => {
    expect(() => compilePattern('x', '(a)\\1')).toThrow(/backreference/);
  });

  it('rejects lookaround', () => {
    expect(() => compilePattern('x', 'a(?=b)')).toThrow(/lookaround|extension/);
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

  it('returns error for nested quantifiers', () => {
    const errs = validateParameterDef('x', { baseType: 'string', pattern: '(a+)+' });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/nested quantifiers/);
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
