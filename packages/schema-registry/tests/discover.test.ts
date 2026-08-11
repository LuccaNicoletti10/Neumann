/**
 * schema-registry — tests/discover.test.ts
 * US 9,330,120 — descoberta automática de schema.
 */
import { describe, expect, it } from 'vitest';

import { discover, parseCsvSample } from '../src/core/discover.js';
import { createDemoOntology, suggestMappings } from '../src/core/mapping.js';

describe('discover (US 9,330,120)', () => {
  it('infere colunas, tipos, hints e PK a partir de amostras', () => {
    const observed = discover({
      source: 'crm',
      object: 'people',
      rows: [
        { id: 1, first_name: 'Ada', email: 'ada@example.com', age: 36 },
        { id: 2, first_name: 'Alan', email: 'alan@example.com', age: null },
      ],
    });
    expect(observed.columns.map((c) => c.column)).toEqual([
      'age',
      'email',
      'first_name',
      'id',
    ]);
    expect(observed.columns.find((c) => c.column === 'id')?.isPrimaryKey).toBe(true);
    expect(observed.columns.find((c) => c.column === 'email')?.semanticHint).toBe('email');
    expect(observed.columns.find((c) => c.column === 'age')?.nullable).toBe(true);
    expect(observed.columns.find((c) => c.column === 'age')?.physicalType).toBe('integer');
  });

  it('parseCsvSample + discover a partir de CSV', () => {
    const csv = 'id,website\n1,https://example.com\n2,https://neumann.dev\n';
    const rows = parseCsvSample(csv);
    const observed = discover({ source: 'web', object: 'sites', rows });
    expect(observed.columns.find((c) => c.column === 'website')?.semanticHint).toBe('url');
  });

  it('rejeita discover sem linhas', () => {
    expect(() => discover({ source: 's', object: 'o', rows: [] })).toThrow(/ao menos uma linha/);
  });

  it('suggestMappings ranqueia nome idêntico e hint', () => {
    const observed = discover({
      source: 'crm',
      object: 'people',
      rows: [{ first_name: 'Ada', email: 'ada@x.com', last_name: 'Lovelace' }],
    });
    const suggestions = suggestMappings(observed.columns, createDemoOntology());
    expect(suggestions[0]?.property).toBeDefined();
    expect(suggestions.some((s) => s.column === 'email' && s.property === 'email')).toBe(true);
    expect(suggestions.some((s) => s.column === 'first_name' && s.score >= 100)).toBe(true);
  });

  it('sugestões são determinísticas', () => {
    const observed = discover({
      source: 'crm',
      object: 'people',
      rows: [{ first_name: 'Ada', last_name: 'L', email: 'a@b.c' }],
    });
    const a = suggestMappings(observed.columns, createDemoOntology());
    const b = suggestMappings(observed.columns, createDemoOntology());
    expect(a).toEqual(b);
  });
});
