/**
 * object-set — src/core/filter.ts
 * Evaluate ObjectSetFilter against object properties.
 *
 * Adapted from OpenFoundry filter evaluation concepts (Apache-2.0).
 */

import type { ObjectRecord, ObjectSetFilter, PropertyValue } from 'contracts';

function cmp(a: unknown, b: PropertyValue): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
  return String(a) < String(b) ? -1 : 1;
}

export function evaluateFilter(obj: ObjectRecord, filter: ObjectSetFilter): boolean {
  switch (filter.type) {
    case 'AND':
      return filter.filters.every((f) => evaluateFilter(obj, f));
    case 'OR':
      return filter.filters.some((f) => evaluateFilter(obj, f));
    case 'NOT':
      return !evaluateFilter(obj, filter.filter);
    case 'EQUALS':
      return obj.properties[filter.property] === filter.value;
    case 'CONTAINS': {
      const v = obj.properties[filter.property];
      return typeof v === 'string' && v.includes(filter.value);
    }
    case 'STARTS_WITH': {
      const v = obj.properties[filter.property];
      return typeof v === 'string' && v.startsWith(filter.value);
    }
    case 'GT':
      return cmp(obj.properties[filter.property], filter.value) > 0;
    case 'GTE':
      return cmp(obj.properties[filter.property], filter.value) >= 0;
    case 'LT':
      return cmp(obj.properties[filter.property], filter.value) < 0;
    case 'LTE':
      return cmp(obj.properties[filter.property], filter.value) <= 0;
    case 'IS_NULL':
      return obj.properties[filter.property] == null;
    case 'IN_SET':
      return filter.values.includes(obj.properties[filter.property] as PropertyValue);
    default:
      return false;
  }
}
