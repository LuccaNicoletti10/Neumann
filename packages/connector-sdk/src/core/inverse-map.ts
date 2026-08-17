/**
 * connector-sdk — src/core/inverse-map.ts
 * Via de retorno (US 8,930,897): PropertyType ↔ campo da fonte.
 * Sync object ↔ plataforma não-objeto (US 10,552,524).
 */

import type { PropertyMapping } from 'contracts';

/** Object properties → source fields (Action → fonte). */
export function propertiesToSourceFields(
  properties: Record<string, unknown>,
  mappings: readonly PropertyMapping[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const m of mappings) {
    if (Object.prototype.hasOwnProperty.call(properties, m.propertyTypeId)) {
      fields[m.sourceField] = coerce(properties[m.propertyTypeId], m.transform);
    }
  }
  return fields;
}

/** Source fields → object properties (fonte → ontology converge). */
export function sourceFieldsToProperties(
  fields: Record<string, unknown>,
  mappings: readonly PropertyMapping[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const m of mappings) {
    if (Object.prototype.hasOwnProperty.call(fields, m.sourceField)) {
      properties[m.propertyTypeId] = coerce(fields[m.sourceField], m.transform);
    }
  }
  return properties;
}

function coerce(
  value: unknown,
  transform: PropertyMapping['transform'],
): unknown {
  if (transform === 'string') return value == null ? '' : String(value);
  if (transform === 'number') return typeof value === 'number' ? value : Number(value);
  if (transform === 'boolean') return Boolean(value);
  return value;
}
