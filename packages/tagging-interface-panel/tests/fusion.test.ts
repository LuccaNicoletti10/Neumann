/**
 * tagging-interface-panel — tests/fusion.test.ts
 * Testes do schema map + transformation component.
 */
import { describe, expect, it } from 'vitest';

import { SchemaMapError, transform, validateSchemaMap } from '../src/core/fusion.js';
import type { DataItem, SchemaMap } from '../src/core/types.js';
import { sampleOntology } from './helpers.js';

const schemaMap: SchemaMap = {
  name: 'pessoas',
  entries: [
    { sourceField: 'id', objectType: 'Person' },
    { sourceField: 'nome', objectType: 'Person', propertyType: 'Name' },
    { sourceField: 'ssn', objectType: 'Person', propertyType: 'Social Security Number' },
  ],
};

const items: DataItem[] = [
  { source: 'csv', id: 'l1', fields: { id: '1', nome: 'Smith, Jane', ssn: '123-45-6789' } },
  { source: 'csv', id: 'l2', fields: { id: '2', nome: 'Doe, John' } },
];

describe('transformation component', () => {
  it('transforma data items em elementos do object model segundo o schema map', () => {
    const elements = transform(schemaMap, items);
    expect(elements).toHaveLength(2);
    expect(elements[0]).toEqual({
      objectType: 'Person',
      id: '1',
      properties: { Name: 'Smith, Jane', 'Social Security Number': '123-45-6789' },
    });
  });

  it('campos ausentes no item são ignorados', () => {
    const elements = transform(schemaMap, items);
    expect(elements[1]?.properties).toEqual({ Name: 'Doe, John' });
    expect(elements[1]?.properties['Social Security Number']).toBeUndefined();
  });

  it('saída é determinística (ordem do schema map e dos itens)', () => {
    const a = transform(schemaMap, items);
    const b = transform(schemaMap, items);
    expect(a).toEqual(b);
  });

  it('valida o schema map contra a ontologia quando fornecida', () => {
    expect(() => transform(schemaMap, items, sampleOntology())).not.toThrow();
  });

  it('rejeita object type desconhecido na ontologia', () => {
    const invalido: SchemaMap = {
      name: 'x',
      entries: [{ sourceField: 'id', objectType: 'Alien' }],
    };
    expect(() => validateSchemaMap(invalido, sampleOntology())).toThrow(SchemaMapError);
    expect(() => validateSchemaMap(invalido, sampleOntology())).toThrow(/object type desconhecido/);
  });

  it('rejeita property type desconhecido na ontologia', () => {
    const invalido: SchemaMap = {
      name: 'x',
      entries: [{ sourceField: 'id', objectType: 'Person', propertyType: 'Inexistente' }],
    };
    expect(() => validateSchemaMap(invalido, sampleOntology())).toThrow(/property type desconhecido/);
  });

  it('item sem nenhum campo mapeado não gera elemento', () => {
    const vazio: DataItem[] = [{ source: 'csv', id: 'l3', fields: { outro: 'x' } }];
    expect(transform(schemaMap, vazio)).toHaveLength(0);
  });
});
