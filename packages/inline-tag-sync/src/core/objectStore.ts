/**
 * inline-tag-sync — src/core/objectStore.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * OBJECT STORE (SEGUNDA PLATAFORMA) — armazena data objects (tipo +
 * propriedades), cria/atualiza objetos e executa a busca de objetos por
 * correspondência do texto do trecho selecionado nas propriedades dos objetos
 * (base do fluxo selecionar → buscar → escolher objeto → escolher propriedade).
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import type { Clock, DataObject, IdGenerator, SearchResult } from './types.js';
import { createIdGenerator, defaultClock } from './types.js';

export interface ObjectStoreDeps {
  clock?: Clock;
  newObjectId?: IdGenerator;
}

export interface CreateObjectInput {
  id?: string;
  type: string;
  properties?: Record<string, string>;
  createdBy?: string;
}

export interface ObjectStore {
  createObject(input: CreateObjectInput): DataObject;
  getObject(id: string): DataObject;
  /** Mescla propriedades em um objeto existente. */
  updateProperties(id: string, properties: Record<string, string>): DataObject;
  /** Substitui integralmente as propriedades de um objeto existente. */
  replaceProperties(id: string, properties: Record<string, string>): DataObject;
  /** Busca objetos cujas propriedades (ou tipo) contenham o texto informado. */
  searchObjects(text: string): SearchResult[];
  listObjects(): DataObject[];
  /** Localiza um objeto pelo valor exato de uma propriedade. */
  findByProperty(propertyKey: string, value: string): DataObject | undefined;
}

/** Rótulo de exibição do objeto: propriedade "name"/"title" ou o próprio tipo. */
export function objectLabel(object: DataObject): string {
  return object.properties['name'] ?? object.properties['title'] ?? object.type;
}

/** Cria o object store em memória (segunda plataforma). */
export function createObjectStore(deps: ObjectStoreDeps = {}): ObjectStore {
  const clock = deps.clock ?? defaultClock;
  const newObjectId = deps.newObjectId ?? createIdGenerator('obj');
  const objects = new Map<string, DataObject>();

  const createObject = (input: CreateObjectInput): DataObject => {
    if (input.type.trim().length === 0) {
      throw new Error('o tipo do objeto não pode ser vazio');
    }
    const id = input.id ?? newObjectId();
    if (objects.has(id)) {
      throw new Error(`já existe um objeto com id "${id}"`);
    }
    const object: DataObject = {
      id,
      type: input.type,
      properties: { ...(input.properties ?? {}) },
      createdBy: input.createdBy ?? 'system',
      createdAt: clock(),
      updatedAt: clock(),
    };
    objects.set(id, object);
    return object;
  };

  const getObject = (id: string): DataObject => {
    const object = objects.get(id);
    if (object === undefined) {
      throw new Error(`objeto não encontrado: "${id}"`);
    }
    return object;
  };

  const updateProperties = (
    id: string,
    properties: Record<string, string>,
  ): DataObject => {
    const object = getObject(id);
    Object.assign(object.properties, properties);
    object.updatedAt = clock();
    return object;
  };

  const replaceProperties = (
    id: string,
    properties: Record<string, string>,
  ): DataObject => {
    const object = getObject(id);
    object.properties = { ...properties };
    object.updatedAt = clock();
    return object;
  };

  const searchObjects = (text: string): SearchResult[] => {
    const query = text.trim().toLowerCase();
    if (query.length === 0) return [];
    const results: SearchResult[] = [];
    const sorted = [...objects.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const object of sorted) {
      const keys = Object.keys(object.properties).sort();
      let matchedProperty: string | undefined;
      for (const key of keys) {
        const value = object.properties[key] ?? '';
        if (value.toLowerCase().includes(query)) {
          matchedProperty = key;
          break;
        }
      }
      if (matchedProperty === undefined && object.type.toLowerCase().includes(query)) {
        results.push({
          objectId: object.id,
          type: object.type,
          label: objectLabel(object),
          matchedProperty: '(tipo)',
          matchedValue: object.type,
        });
        continue;
      }
      if (matchedProperty !== undefined) {
        results.push({
          objectId: object.id,
          type: object.type,
          label: objectLabel(object),
          matchedProperty,
          matchedValue: object.properties[matchedProperty] ?? '',
        });
      }
    }
    return results;
  };

  const listObjects = (): DataObject[] =>
    [...objects.values()].sort((a, b) => a.id.localeCompare(b.id));

  const findByProperty = (
    propertyKey: string,
    value: string,
  ): DataObject | undefined =>
    listObjects().find((object) => object.properties[propertyKey] === value);

  return {
    createObject,
    getObject,
    updateProperties,
    replaceProperties,
    searchObjects,
    listObjects,
    findByProperty,
  };
}
