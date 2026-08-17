/**
 * query-api — src/core/templates.ts
 * Search templates = ObjectSetFilter parametrizado (US 10,726,032 / US 8,868,537).
 * Geração a partir de object type / propriedades da ontologia (US 9,262,529) — sem GUI.
 */

import type { ObjectSetFilter, SearchTemplate } from 'contracts';

import { bindFilterParams } from './filter.js';

export function generateSearchTemplate(
  objectTypeId: string,
  fields: readonly string[],
  name?: string,
): SearchTemplate {
  const clauses: ObjectSetFilter[] = fields.map((field) => ({
    type: 'EQUALS',
    property: field,
    value: `$${field}`,
  }));
  return {
    id: `tpl.${objectTypeId.replace(/^ot\./, '')}`,
    name: name ?? `${objectTypeId} search`,
    objectTypeId,
    filter: { type: 'AND', filters: clauses },
  };
}

export function applyTemplate(
  template: SearchTemplate,
  params: Record<string, unknown>,
): ObjectSetFilter {
  return bindFilterParams(template.filter, params);
}
