/**
 * contracts — src/v1/action-parameter-schema.ts
 *
 * Canonical ActionTypeDef parameter schema. OntologyRegistry (commit) and
 * ActionExecutor (apply) MUST import this module — never a second copy.
 *
 * WHY: a JS RegExp on an untrusted pattern can hang the event loop via
 * catastrophic backtracking. Patterns are admitted only in a linear-safe
 * subset (no nested quantifiers, backreferences, or lookaround). Matching
 * uses RegExp only after that gate.
 */

import type { ActionParameterDef, ActionTypeDef } from './ontology.js';

export interface ActionParameterSchemaError {
  field: string;
  message: string;
}

const BASE_TYPE_JS: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  datetime: 'string',
  object_ref: 'string',
  struct: 'object',
  object_reference: 'string',
};

const NUMERIC_TYPES = new Set(['number']);

// WHY: length cap is not a ReDoS defence; it only bounds scanner/compiler work.
const MAX_PATTERN_LENGTH = 1000;

export interface SafePattern {
  readonly source: string;
  test(value: string): boolean;
}

function isQuantifierStart(c: string | undefined): boolean {
  return c === '*' || c === '+' || c === '?' || c === '{';
}

function skipQuantifier(pattern: string, idx: number): number {
  const n = pattern.length;
  if (idx >= n) return idx;
  const c = pattern[idx];
  if (c === '*' || c === '+' || c === '?') {
    idx += 1;
    if (pattern[idx] === '?') idx += 1;
    return idx;
  }
  if (c === '{') {
    idx += 1;
    while (idx < n && pattern[idx] !== '}') idx += 1;
    if (idx < n && pattern[idx] === '}') idx += 1;
    if (pattern[idx] === '?') idx += 1;
    return idx;
  }
  return idx;
}

/**
 * Nested quantifiers such as `(a+)+` are the textbook ReDoS shape.
 * Scanner only — never executes the user pattern.
 */
export function hasNestedQuantifiers(pattern: string): boolean {
  const n = pattern.length;
  type Group = { hasQuantified: boolean };
  const stack: Group[] = [{ hasQuantified: false }];
  let inClass = false;
  let escaped = false;
  let i = 0;

  while (i < n) {
    const c = pattern[i]!;
    if (escaped) {
      escaped = false;
      i += 1;
      if (isQuantifierStart(pattern[i])) {
        const parent = stack[stack.length - 1];
        if (parent) parent.hasQuantified = true;
        i = skipQuantifier(pattern, i);
      }
      continue;
    }
    if (c === '\\') {
      escaped = true;
      i += 1;
      continue;
    }
    if (inClass) {
      if (c === ']') {
        inClass = false;
        i += 1;
        if (isQuantifierStart(pattern[i])) {
          const parent = stack[stack.length - 1];
          if (parent) parent.hasQuantified = true;
          i = skipQuantifier(pattern, i);
        }
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '[') {
      inClass = true;
      i += 1;
      continue;
    }
    if (c === '(') {
      stack.push({ hasQuantified: false });
      i += 1;
      continue;
    }
    if (c === ')') {
      const group = stack.pop();
      i += 1;
      if (isQuantifierStart(pattern[i])) {
        if (group?.hasQuantified) return true;
        const parent = stack[stack.length - 1];
        if (parent) parent.hasQuantified = true;
        i = skipQuantifier(pattern, i);
      }
      continue;
    }
    i += 1;
    if (isQuantifierStart(pattern[i])) {
      const parent = stack[stack.length - 1];
      if (parent) parent.hasQuantified = true;
      i = skipQuantifier(pattern, i);
    }
  }
  return false;
}

function assertLinearSafePattern(name: string, pattern: string): void {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(
      `parameter "${name}" pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
    );
  }
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== '\\') continue;
    const next = pattern[i + 1];
    if (next !== undefined && next >= '1' && next <= '9') {
      throw new Error(`parameter "${name}" pattern is unsafe (backreference)`);
    }
    i += 1;
  }
  if (/\(\?(?![:])/.test(pattern)) {
    throw new Error(`parameter "${name}" pattern is unsafe (lookaround or extension)`);
  }
  if (hasNestedQuantifiers(pattern)) {
    throw new Error(`parameter "${name}" pattern is unsafe (nested quantifiers)`);
  }
}

/**
 * Admit a pattern into the linear-safe subset. Throws on invalid syntax or
 * a ReDoS-capable shape. Call at ontology commit; apply-time matching reuses
 * the same function so a bypassed def still cannot reach `RegExp#test`
 * on an untrusted pattern.
 */
export function compilePattern(name: string, pattern: string): SafePattern {
  assertLinearSafePattern(name, pattern);
  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern);
  } catch {
    throw new Error(`parameter "${name}" has an invalid pattern: ${pattern}`);
  }
  return {
    source: pattern,
    test(value: string): boolean {
      return compiled.test(value);
    },
  };
}

export function validateParameterDef(
  name: string,
  def: ActionParameterDef,
): ActionParameterSchemaError[] {
  const errors: ActionParameterSchemaError[] = [];

  if (def.pattern !== undefined) {
    try {
      compilePattern(name, def.pattern);
    } catch (e) {
      errors.push({ field: name, message: (e as Error).message });
    }
  }

  if ((def.min !== undefined || def.max !== undefined) && !NUMERIC_TYPES.has(def.baseType)) {
    errors.push({
      field: name,
      message: `parameter "${name}" has min/max bounds but baseType is "${def.baseType}" (only numeric types support bounds)`,
    });
  }

  if (def.allowedValues && def.allowedValues.length > 0) {
    const expectedJsType = BASE_TYPE_JS[def.baseType];
    if (expectedJsType) {
      for (const v of def.allowedValues) {
        if (typeof v !== expectedJsType) {
          errors.push({
            field: name,
            message: `parameter "${name}" allowedValues contains "${String(v)}" which is not a valid ${def.baseType} value`,
          });
          break;
        }
      }
    }
  }

  return errors;
}

export function validateActionTypeDefSchema(def: ActionTypeDef): ActionParameterSchemaError[] {
  const errors: ActionParameterSchemaError[] = [];
  for (const [name, paramDef] of Object.entries(def.parameters ?? {})) {
    errors.push(...validateParameterDef(name, paramDef));
  }
  return errors;
}
