/**
 * object-set — src/core/filter.ts
 * Evaluate ObjectSetFilter against object properties (post-coercion).
 *
 * Adapted from OpenFoundry filter evaluation concepts (Apache-2.0).
 */

import type { ObjectRecord, ObjectSetFilter, PropertyValue } from 'contracts';

import { coerceValue, type PropertyTypeLookup } from './coerce.js';

function asComparable(a: unknown, bt: ReturnType<PropertyTypeLookup> | undefined): unknown {
  if (a === null || a === undefined) return null;
  if (!bt) {
    if (typeof a === 'number' || typeof a === 'boolean') return a;
    const n = typeof a === 'string' && a.trim() !== '' && Number.isFinite(Number(a)) ? Number(a) : NaN;
    if (!Number.isNaN(n) && String(n) === String(a).trim()) return n;
    return a;
  }
  try {
    return coerceValue(a, bt);
  } catch {
    return a;
  }
}

function cmp(a: unknown, b: PropertyValue, bt: ReturnType<PropertyTypeLookup> | undefined): number {
  const av = asComparable(a, bt);
  const bv = asComparable(b, bt);
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  if (typeof av === 'number' && typeof bv === 'number') return av < bv ? -1 : av > bv ? 1 : 0;
  return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
}

export function evaluateFilter(
  obj: ObjectRecord,
  filter: ObjectSetFilter,
  lookup?: PropertyTypeLookup,
): boolean {
  switch (filter.type) {
    case 'AND':
      return filter.filters.every((f) => evaluateFilter(obj, f, lookup));
    case 'OR':
      return filter.filters.some((f) => evaluateFilter(obj, f, lookup));
    case 'NOT':
      return !evaluateFilter(obj, filter.filter, lookup);
    case 'EQUALS': {
      const bt = lookup?.(obj.objectTypeId, filter.property);
      return asComparable(obj.properties[filter.property], bt) === asComparable(filter.value, bt);
    }
    case 'NOT_EQUALS': {
      const bt = lookup?.(obj.objectTypeId, filter.property);
      return asComparable(obj.properties[filter.property], bt) !== asComparable(filter.value, bt);
    }
    case 'CONTAINS': {
      const v = obj.properties[filter.property];
      return typeof v === 'string' && v.includes(filter.value);
    }
    case 'STARTS_WITH': {
      const v = obj.properties[filter.property];
      return typeof v === 'string' && v.startsWith(filter.value);
    }
    case 'ENDS_WITH': {
      const v = obj.properties[filter.property];
      return typeof v === 'string' && v.endsWith(filter.value);
    }
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      // Ordering against null is undefined — false on both engines (SQL: FALSE).
      if (filter.value == null) return false;
      const got = obj.properties[filter.property];
      if (got == null) return false;
      const c = cmp(got, filter.value, lookup?.(obj.objectTypeId, filter.property));
      if (filter.type === 'GT') return c > 0;
      if (filter.type === 'GTE') return c >= 0;
      if (filter.type === 'LT') return c < 0;
      return c <= 0;
    }
    case 'IS_NULL':
      return obj.properties[filter.property] == null;
    case 'IN_SET': {
      const bt = lookup?.(obj.objectTypeId, filter.property);
      const got = asComparable(obj.properties[filter.property], bt);
      return filter.values.some((v) => asComparable(v, bt) === got);
    }
    default:
      return false;
  }
}
