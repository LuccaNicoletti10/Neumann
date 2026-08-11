/**
 * inline-tag-sync — tests/objectStore.test.ts
 * Testes do object store (segunda plataforma): criação, busca e atualização.
 */
import { describe, expect, it } from 'vitest';

import { createObjectStore, objectLabel } from '../src/core/objectStore.js';
import { FIXED_NOW, makeStore } from './helpers.js';

describe('object store (segunda plataforma)', () => {
  it('cria objeto com tipo e propriedades', () => {
    const store = createObjectStore({ clock: () => FIXED_NOW });
    const obj = store.createObject({
      id: 'obj-1',
      type: 'Person',
      properties: { name: 'Ada' },
      createdBy: 'ana',
    });
    expect(obj.id).toBe('obj-1');
    expect(obj.type).toBe('Person');
    expect(obj.properties).toEqual({ name: 'Ada' });
    expect(obj.createdAt).toBe(FIXED_NOW);
    expect(obj.updatedAt).toBe(FIXED_NOW);
  });

  it('gera ids determinísticos sequenciais (obj-1, obj-2)', () => {
    const store = createObjectStore();
    expect(store.createObject({ type: 'A' }).id).toBe('obj-1');
    expect(store.createObject({ type: 'B' }).id).toBe('obj-2');
  });

  it('rejeita id duplicado e tipo vazio', () => {
    const store = createObjectStore();
    store.createObject({ id: 'obj-x', type: 'A' });
    expect(() => store.createObject({ id: 'obj-x', type: 'B' })).toThrow(/já existe/);
    expect(() => store.createObject({ type: '  ' })).toThrow(/não pode ser vazio/);
  });

  it('getObject devolve o objeto e falha para id desconhecido', () => {
    const store = makeStore();
    expect(store.getObject('obj-john').type).toBe('Person');
    expect(() => store.getObject('obj-zzz')).toThrow(/objeto não encontrado/);
  });

  it('busca objetos por correspondência em propriedades (case-insensitive)', () => {
    const store = makeStore();
    const results = store.searchObjects('john doe');
    expect(results).toHaveLength(1);
    expect(results[0]?.objectId).toBe('obj-john');
    expect(results[0]?.label).toBe("John Doe's Profile");
    expect(results[0]?.matchedProperty).toBe('name');
  });

  it('busca encontra "Local News" pela propriedade title', () => {
    const store = makeStore();
    const results = store.searchObjects('Local News');
    expect(results.map((r) => r.objectId)).toEqual(['obj-news']);
  });

  it('busca sem correspondência devolve lista vazia', () => {
    const store = makeStore();
    expect(store.searchObjects('zzz inexistente')).toEqual([]);
    expect(store.searchObjects('   ')).toEqual([]);
  });

  it('busca por tipo de objeto quando nenhuma propriedade corresponde', () => {
    const store = makeStore();
    const results = store.searchObjects('article');
    expect(results).toHaveLength(1);
    expect(results[0]?.matchedProperty).toBe('(tipo)');
  });

  it('resultados da busca têm ordem determinística por id', () => {
    const store = makeStore();
    store.createObject({ id: 'obj-aaa', type: 'Person', properties: { email: 'x@y.com' } });
    const results = store.searchObjects('person');
    expect(results.map((r) => r.objectId)).toEqual(['obj-aaa', 'obj-john']);
  });

  it('atualiza e substitui propriedades de um objeto', () => {
    const store = makeStore();
    store.updateProperties('obj-john', { city: 'Springfield' });
    expect(store.getObject('obj-john').properties['city']).toBe('Springfield');
    expect(store.getObject('obj-john').properties['name']).toBe("John Doe's Profile");
    store.replaceProperties('obj-john', { name: 'J. Doe' });
    expect(store.getObject('obj-john').properties).toEqual({ name: 'J. Doe' });
  });

  it('findByProperty localiza objeto pelo valor exato', () => {
    const store = makeStore();
    expect(store.findByProperty('title', 'Local News')?.id).toBe('obj-news');
    expect(store.findByProperty('title', 'Inexistente')).toBeUndefined();
  });

  it('objectLabel usa name/title e cai para o tipo', () => {
    const store = createObjectStore();
    const semNome = store.createObject({ type: 'Event', properties: { date: 'segunda' } });
    expect(objectLabel(semNome)).toBe('Event');
  });
});
