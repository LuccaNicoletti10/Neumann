/**
 * schema-registry — src/core/mapping.ts
 *
 * US 9,330,120 — mapeamento assistido schema → ontologia (sugestões
 * determinísticas por nome/hint/tipo; o usuário confirma no painel visual).
 */

import type {
  MappingSuggestion,
  ObservedColumn,
  OntologyObjectDef,
  PhysicalType,
} from './types.js';

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function typeCompatible(a: PhysicalType, b: PhysicalType): boolean {
  if (a === b) return true;
  if (a === 'unknown' || b === 'unknown') return true;
  if (a === 'string' || b === 'string') return true;
  const numeric = new Set(['boolean', 'integer', 'bigint', 'decimal', 'float']);
  if (numeric.has(a) && numeric.has(b)) return true;
  const temporal = new Set(['date', 'datetime']);
  if (temporal.has(a) && temporal.has(b)) return true;
  return false;
}

/**
 * Sugere mapeamentos coluna→propriedade da ontologia, ordenados por score
 * descendente (depois objectType, property — determinístico).
 */
export function suggestMappings(
  columns: readonly ObservedColumn[],
  ontology: readonly OntologyObjectDef[],
  limit = 20,
): MappingSuggestion[] {
  const suggestions: MappingSuggestion[] = [];

  for (const column of columns) {
    const colNorm = normalizeName(column.column);
    for (const objectType of ontology) {
      for (const prop of objectType.properties) {
        const propNorm = normalizeName(prop.name);
        let score = 0;
        const reasons: string[] = [];

        if (colNorm === propNorm) {
          score += 100;
          reasons.push('nome idêntico');
        } else if (colNorm.includes(propNorm) || propNorm.includes(colNorm)) {
          score += 60;
          reasons.push('nome parcial');
        } else if (
          colNorm.replace(/_/g, '') === propNorm.replace(/_/g, '')
        ) {
          score += 80;
          reasons.push('nome equivalente');
        }

        if (
          column.semanticHint !== undefined &&
          prop.hint !== undefined &&
          column.semanticHint === prop.hint
        ) {
          score += 40;
          reasons.push('hint semântico');
        }

        if (typeCompatible(column.physicalType, prop.physicalType)) {
          score += 15;
          reasons.push('tipo compatível');
        } else {
          score -= 30;
          reasons.push('tipo incompatível');
        }

        if (score >= 50) {
          suggestions.push({
            column: column.column,
            objectType: objectType.name,
            property: prop.name,
            score,
            reason: reasons.join(', '),
          });
        }
      }
    }
  }

  suggestions.sort(
    (a, b) =>
      b.score - a.score ||
      a.objectType.localeCompare(b.objectType) ||
      a.property.localeCompare(b.property) ||
      a.column.localeCompare(b.column),
  );

  return suggestions.slice(0, limit);
}

/** Ontologia mínima de demonstração (Person / Event / Entity). */
export function createDemoOntology(): OntologyObjectDef[] {
  return [
    {
      name: 'Person',
      properties: [
        { name: 'first_name', physicalType: 'string', required: true },
        { name: 'last_name', physicalType: 'string', required: true },
        { name: 'email', physicalType: 'string', hint: 'email' },
        { name: 'phone', physicalType: 'string', hint: 'phone' },
        { name: 'birth_date', physicalType: 'date' },
      ],
    },
    {
      name: 'Event',
      properties: [
        { name: 'name', physicalType: 'string', required: true },
        { name: 'date', physicalType: 'datetime' },
        { name: 'location', physicalType: 'string' },
      ],
    },
    {
      name: 'Entity',
      properties: [
        { name: 'name', physicalType: 'string', required: true },
        { name: 'website', physicalType: 'string', hint: 'url' },
        { name: 'employee_count', physicalType: 'integer' },
      ],
    },
  ];
}
