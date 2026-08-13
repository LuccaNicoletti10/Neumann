/**
 * object-set — src/core/normalize.ts
 * Normalize API aliases → canonical ObjectSetFilter AST.
 */

import type { ObjectSetFilter, PropertyValue } from 'contracts';
import { invalidArgument } from 'api-errors';

const ALIAS: Record<string, ObjectSetFilter['type']> = {
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  EQUALS: 'EQUALS',
  EQ: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  NEQ: 'NOT_EQUALS',
  NE: 'NOT_EQUALS',
  CONTAINS: 'CONTAINS',
  STARTS_WITH: 'STARTS_WITH',
  STARTSWITH: 'STARTS_WITH',
  ENDS_WITH: 'ENDS_WITH',
  ENDSWITH: 'ENDS_WITH',
  GT: 'GT',
  GTE: 'GTE',
  LT: 'LT',
  LTE: 'LTE',
  IS_NULL: 'IS_NULL',
  ISNULL: 'IS_NULL',
  IN_SET: 'IN_SET',
  IN: 'IN_SET',
};

export function normalizeFilter(raw: unknown, depth = 0): ObjectSetFilter {
  if (depth > 32) throw invalidArgument('ObjectSet filter exceeds max depth');
  if (!raw || typeof raw !== 'object') {
    throw invalidArgument('filter must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const typeKey = String(obj.type ?? '').toUpperCase().replace(/-/g, '_');
  const type = ALIAS[typeKey];
  if (!type) throw invalidArgument(`unsupported filter type: ${obj.type}`);

  switch (type) {
    case 'AND':
    case 'OR':
      return {
        type,
        filters: ((obj.filters as unknown[]) ?? []).map((f) => normalizeFilter(f, depth + 1)),
      };
    case 'NOT':
      return { type, filter: normalizeFilter(obj.filter, depth + 1) };
    case 'EQUALS':
    case 'NOT_EQUALS':
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE':
      return {
        type,
        property: String(obj.property),
        value: obj.value as PropertyValue,
      };
    case 'CONTAINS':
    case 'STARTS_WITH':
    case 'ENDS_WITH':
      return { type, property: String(obj.property), value: String(obj.value ?? '') };
    case 'IS_NULL':
      return { type, property: String(obj.property) };
    case 'IN_SET':
      return {
        type,
        property: String(obj.property),
        values: (obj.values as PropertyValue[]) ?? [],
      };
    default:
      throw invalidArgument(`unsupported filter type: ${type}`);
  }
}
