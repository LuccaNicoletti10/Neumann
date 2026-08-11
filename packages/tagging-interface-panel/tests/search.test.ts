/**
 * tagging-interface-panel — tests/search.test.ts
 * Testes do search for object field (416), sync e criação de tipos.
 */
import { describe, expect, it } from 'vitest';

import { createOntologyBuilder, isRepresentative } from '../src/core/ontology.js';
import { createDemoInternalDatabase } from '../src/core/panel.js';
import {
  createInMemoryDatabase,
  createTypesForExisting,
  LoginRequiredError,
  searchForObject,
  syncTaggedObject,
} from '../src/core/search.js';
import type { TaggedObject } from '../src/core/types.js';

const tagged: TaggedObject = { tagId: 'tag-1', title: 'Curiosity', type: 'Ground Travel' };

describe('searchForObject (416)', () => {
  it('busca "Curiosity" exibe o objeto existente associado', () => {
    const results = searchForObject(createDemoInternalDatabase(), 'Curiosity');
    expect(results).toHaveLength(1);
    expect(results[0]?.objectId).toBe('obj-curiosity');
  });

  it('busca por tipo de objeto também casa', () => {
    const results = searchForObject(createDemoInternalDatabase(), 'Vehicle');
    expect(results).toHaveLength(2);
  });

  it('consulta vazia ou sem casamento retorna lista vazia', () => {
    const db = createDemoInternalDatabase();
    expect(searchForObject(db, '   ')).toHaveLength(0);
    expect(searchForObject(db, 'inexistente')).toHaveLength(0);
  });

  it('busca é case-insensitive e determinística', () => {
    const db = createInMemoryDatabase([
      { objectId: 'a', objectType: 'Vehicle', properties: { Name: 'Curiosity One' } },
      { objectId: 'b', objectType: 'Vehicle', properties: { Name: 'curiosity two' } },
    ]);
    const results = searchForObject(db, 'CURIOSITY');
    expect(results.map((r) => r.objectId)).toEqual(['a', 'b']);
  });
});

describe('syncTaggedObject', () => {
  it('SYNC exige login: sem login lança LoginRequiredError', () => {
    expect(() =>
      syncTaggedObject(createDemoInternalDatabase(), tagged, 'obj-curiosity', {
        loggedIn: false,
      }),
    ).toThrow(LoginRequiredError);
    expect(() =>
      syncTaggedObject(createDemoInternalDatabase(), tagged, 'obj-curiosity', {
        loggedIn: false,
      }),
    ).toThrow(/LOGIN_REQUIRED/);
  });

  it('com login, sincroniza o objeto tagueado com o objeto existente', () => {
    const synced = syncTaggedObject(createDemoInternalDatabase(), tagged, 'obj-curiosity', {
      loggedIn: true,
    });
    expect(synced.syncedObjectId).toBe('obj-curiosity');
  });

  it('objeto inexistente no internal database lança erro', () => {
    expect(() =>
      syncTaggedObject(createDemoInternalDatabase(), tagged, 'obj-x', { loggedIn: true }),
    ).toThrow(/objeto não encontrado/);
  });
});

describe('createTypesForExisting', () => {
  it('cria object types e property types para entidades existentes', () => {
    const builder = createOntologyBuilder('teste');
    const results = searchForObject(createDemoInternalDatabase(), 'Curiosity');
    createTypesForExisting(builder, results);
    const ontology = builder.build();
    expect(ontology.objectTypes.map((o) => o.name)).toContain('Vehicle');
    expect(ontology.propertyTypes.map((p) => p.name)).toContain('Name');
    expect(isRepresentative(ontology, 'Name', 'Vehicle')).toBe(true);
  });

  it('infere base type dos valores das propriedades', () => {
    const builder = createOntologyBuilder('teste');
    createTypesForExisting(builder, [
      {
        objectId: 'x',
        objectType: 'Person',
        properties: { Age: '42', Score: '9.5', Since: '2014-09-18', Name: 'Ada' },
      },
    ]);
    const ontology = builder.build();
    const baseTypeOf = (n: string) => ontology.propertyTypes.find((p) => p.name === n)?.baseType;
    expect(baseTypeOf('Age')).toBe('integer');
    expect(baseTypeOf('Score')).toBe('number');
    expect(baseTypeOf('Since')).toBe('date');
    expect(baseTypeOf('Name')).toBe('string');
  });
});
