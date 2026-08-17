/**
 * function-registry — src/core/purity.ts
 * Freeze + clone: function NUNCA vê nem devolve mutações nos objetos de entrada.
 */

import type { FunctionImpl, FunctionObjectInput } from 'contracts';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function snapshotObjects(
  objects: FunctionObjectInput[],
): FunctionObjectInput[] {
  return structuredClone(objects);
}

export function invokePure(
  impl: FunctionImpl,
  objects: FunctionObjectInput[],
  params?: Record<string, unknown>,
): unknown {
  const frozenObjects = deepFreeze(structuredClone(objects));
  const frozenParams = deepFreeze(structuredClone(params ?? {}));
  let result: unknown;
  try {
    result = impl(frozenObjects, frozenParams);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('FunctionImpl: mutação detectada (function deve ser pura)');
    }
    throw err;
  }
  if (result != null && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
    throw new Error('FunctionImpl: deve ser síncrona (sem Promise)');
  }
  return result;
}
