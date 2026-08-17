/**
 * query-api — src/core/filter.ts
 * Filter chain = ObjectSetFilter AST (US 8,041,714 / US 8,280,880).
 * Avaliado só sobre propriedades visíveis (fail-closed).
 */

import type { ObjectSetFilter, SearchDocument, SearchPrincipal } from 'contracts';

import { visibleProperties } from './acl.js';

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function matchesFilter(
  doc: SearchDocument,
  filter: ObjectSetFilter,
  user: SearchPrincipal,
): boolean {
  const props = visibleProperties(doc, user);
  return evalOn(props, filter);
}

function evalOn(props: Record<string, unknown>, filter: ObjectSetFilter): boolean {
  switch (filter.type) {
    case 'AND':
      return filter.filters.every((f) => evalOn(props, f));
    case 'OR':
      return filter.filters.some((f) => evalOn(props, f));
    case 'NOT':
      return !evalOn(props, filter.filter);
    case 'EQUALS':
      return props[filter.property] === filter.value;
    case 'NOT_EQUALS':
      return props[filter.property] !== filter.value;
    case 'CONTAINS': {
      const v = props[filter.property];
      return typeof v === 'string' && v.includes(String(filter.value));
    }
    case 'STARTS_WITH': {
      const v = props[filter.property];
      return typeof v === 'string' && v.startsWith(String(filter.value));
    }
    case 'ENDS_WITH': {
      const v = props[filter.property];
      return typeof v === 'string' && v.endsWith(String(filter.value));
    }
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      if (filter.value == null) return false;
      const got = props[filter.property];
      if (got == null) return false;
      const c = cmp(got, filter.value);
      if (filter.type === 'GT') return c > 0;
      if (filter.type === 'GTE') return c >= 0;
      if (filter.type === 'LT') return c < 0;
      return c <= 0;
    }
    case 'IS_NULL':
      return props[filter.property] == null;
    case 'IN_SET':
      return filter.values.some((v) => props[filter.property] === v);
    default:
      return false;
  }
}

/** Substitui `$param` em valores string do filtro. */
export function bindFilterParams(
  filter: ObjectSetFilter,
  params: Record<string, unknown>,
): ObjectSetFilter {
  switch (filter.type) {
    case 'AND':
    case 'OR':
      return { ...filter, filters: filter.filters.map((f) => bindFilterParams(f, params)) };
    case 'NOT':
      return { ...filter, filter: bindFilterParams(filter.filter, params) };
    case 'EQUALS':
    case 'NOT_EQUALS':
    case 'CONTAINS':
    case 'STARTS_WITH':
    case 'ENDS_WITH':
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      const raw = filter.value;
      if (typeof raw === 'string' && raw.startsWith('$')) {
        const bound = params[raw.slice(1)];
        if (bound === undefined) {
          return { type: 'AND', filters: [] };
        }
        return { ...filter, value: bound as never };
      }
      return filter;
    }
    default:
      return filter;
  }
}
