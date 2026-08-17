/**
 * query-api — src/core/nl-parse.ts
 * NL → SearchQuery estruturada (US 11,238,102 / US 9,262,529). Sem LLM.
 *
 * Exemplos:
 *   "acme"
 *   "type:ot.customer acme"
 *   "status=open acme"
 */

import type { ObjectSetFilter, SearchQuery } from 'contracts';

const TYPE_ALIASES: Record<string, string> = {
  customer: 'ot.customer',
  customers: 'ot.customer',
  order: 'ot.sales_order',
  orders: 'ot.sales_order',
  product: 'ot.product',
  products: 'ot.product',
};

export function parseNaturalQuery(text: string): SearchQuery {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const objectTypeIds: string[] = [];
  const filters: ObjectSetFilter[] = [];
  const rest: string[] = [];

  for (const tok of tokens) {
    const typeMatch = tok.match(/^type:(.+)$/i);
    if (typeMatch?.[1]) {
      const raw = typeMatch[1];
      objectTypeIds.push(TYPE_ALIASES[raw.toLowerCase()] ?? raw);
      continue;
    }
    const eq = tok.match(/^([a-zA-Z_][\w.]*)=(.+)$/);
    if (eq?.[1] && eq[2] !== undefined) {
      filters.push({ type: 'EQUALS', property: eq[1], value: eq[2] });
      continue;
    }
    const alias = TYPE_ALIASES[tok.toLowerCase()];
    if (alias && rest.length === 0 && filters.length === 0 && objectTypeIds.length === 0) {
      objectTypeIds.push(alias);
      continue;
    }
    rest.push(tok);
  }

  const q = rest.join(' ').trim();
  const filter: ObjectSetFilter | undefined =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : { type: 'AND', filters };

  return {
    ...(q ? { q } : {}),
    ...(objectTypeIds.length ? { objectTypeIds } : {}),
    ...(filter ? { filter } : {}),
  };
}
