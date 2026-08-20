/**
 * action-engine — src/core/action-parameter-validator.ts
 *
 * WHY: apply-time parameter checks complete before the business transaction.
 * Schema admission (regex subset, min/max, allowedValues types) lives in
 * `contracts` so OntologyRegistry and this executor share one implementation.
 */

import {
  compilePattern,
  validateActionTypeDefSchema,
  validateParameterDef,
  type ActionParameterDef,
  type ActionParameterSchemaError,
  type ActionTypeDef,
} from 'contracts';

export type ValidationError = ActionParameterSchemaError;
export { compilePattern, validateActionTypeDefSchema, validateParameterDef };

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

function checkBaseType(
  name: string,
  value: unknown,
  def: ActionParameterDef,
): ValidationError | undefined {
  if (value === null || value === undefined) return undefined;
  const expected = BASE_TYPE_JS[def.baseType];
  if (!expected) return undefined;
  if (typeof value !== expected) {
    return { field: name, message: `parameter "${name}" must be ${expected} (got ${typeof value})` };
  }
  return undefined;
}

function checkAllowedValues(
  name: string,
  value: unknown,
  def: ActionParameterDef,
): ValidationError | undefined {
  if (!def.allowedValues || def.allowedValues.length === 0) return undefined;
  if (value === null || value === undefined) return undefined;
  if (!(def.allowedValues as readonly unknown[]).includes(value)) {
    return {
      field: name,
      message: `parameter "${name}" must be one of [${def.allowedValues.join(', ')}] (got "${String(value)}")`,
    };
  }
  return undefined;
}

function checkPattern(
  name: string,
  value: unknown,
  def: ActionParameterDef,
): ValidationError | undefined {
  if (!def.pattern) return undefined;
  if (typeof value !== 'string') return undefined;
  // WHY: compilePattern is the same gate as ontology commit. A def that
  // bypassed the registry still cannot run an untrusted RegExp on the event loop.
  let re: { test(s: string): boolean };
  try {
    re = compilePattern(name, def.pattern);
  } catch (e) {
    return { field: name, message: (e as Error).message };
  }
  if (!re.test(value)) {
    return { field: name, message: `parameter "${name}" does not match required pattern` };
  }
  return undefined;
}

function checkNumericBounds(
  name: string,
  value: unknown,
  def: ActionParameterDef,
): ValidationError | undefined {
  if (!NUMERIC_TYPES.has(def.baseType)) return undefined;
  if (typeof value !== 'number') return undefined;
  if (def.min !== undefined && value < def.min) {
    return { field: name, message: `parameter "${name}" must be >= ${def.min} (got ${value})` };
  }
  if (def.max !== undefined && value > def.max) {
    return { field: name, message: `parameter "${name}" must be <= ${def.max} (got ${value})` };
  }
  return undefined;
}

/**
 * Canonical apply-time parameter validator for ActionTypeDef.
 *
 * Returns an array of errors; empty = valid.
 * Validation MUST complete before the business transaction begins.
 */
export function validateActionParameters(
  def: ActionTypeDef,
  params: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const declared = def.parameters ?? {};

  for (const [name, paramDef] of Object.entries(declared)) {
    const v = params[name];
    const absent = v === undefined || v === null || v === '';

    if (absent) {
      // WHY: required defaults to true — fail closed on absent values unless explicitly optional
      if (paramDef.required !== false && !paramDef.nullable) {
        errors.push({ field: name, message: `parameter "${name}" is required` });
      }
      continue;
    }

    const typeError = checkBaseType(name, v, paramDef);
    if (typeError) {
      errors.push(typeError);
      continue;
    }

    const enumError = checkAllowedValues(name, v, paramDef);
    if (enumError) errors.push(enumError);

    const patternError = checkPattern(name, v, paramDef);
    if (patternError) errors.push(patternError);

    const boundsError = checkNumericBounds(name, v, paramDef);
    if (boundsError) errors.push(boundsError);
  }

  for (const key of Object.keys(params)) {
    if (!(key in declared)) {
      errors.push({ field: key, message: `parameter "${key}" is not declared on this action` });
    }
  }

  return errors;
}
