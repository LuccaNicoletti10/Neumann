/**
 * tagging-interface-panel — src/core/fusion.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: SCHEMA MAP
 * + TRANSFORMATION COMPONENT — transforma data items de fontes externas em
 * elementos do object model (objetos com propriedades) de acordo com o schema
 * map, validando object types e property types contra a ontologia. Nenhum
 * texto dos claims é reproduzido; apenas a funcionalidade é reimplementada
 * de forma original.
 */

import { findObjectType, findPropertyType } from './ontology.js';
import type {
  DataItem,
  ObjectModelElement,
  Ontology,
  SchemaMap,
} from './types.js';

/** Erro de validação do schema map contra a ontologia. */
export class SchemaMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMapError';
  }
}

/**
 * Valida o schema map contra a ontologia: todo object type referenciado
 * precisa existir, e todo property type precisa existir na ontologia.
 */
export function validateSchemaMap(schemaMap: SchemaMap, ontology: Ontology): void {
  for (const entry of schemaMap.entries) {
    if (findObjectType(ontology, entry.objectType) === undefined) {
      throw new SchemaMapError(`object type desconhecido no schema map: ${entry.objectType}`);
    }
    if (
      entry.propertyType !== undefined &&
      findPropertyType(ontology, entry.propertyType) === undefined
    ) {
      throw new SchemaMapError(`property type desconhecido no schema map: ${entry.propertyType}`);
    }
  }
}

/**
 * Transformation component: para cada data item, produz um elemento do
 * object model por object type presente no schema map. Entradas sem
 * `propertyType` identificam o campo que vira o `id` do elemento; entradas
 * com `propertyType` preenchem `properties`. Campos ausentes no item são
 * ignorados. A saída é determinística (ordem do schema map e dos itens).
 */
export function transform(
  schemaMap: SchemaMap,
  items: readonly DataItem[],
  ontology?: Ontology,
): ObjectModelElement[] {
  if (ontology !== undefined) {
    validateSchemaMap(schemaMap, ontology);
  }
  // Object types do schema map, na ordem de primeira aparição.
  const objectTypes: string[] = [];
  for (const entry of schemaMap.entries) {
    if (!objectTypes.includes(entry.objectType)) {
      objectTypes.push(entry.objectType);
    }
  }
  const elements: ObjectModelElement[] = [];
  for (const item of items) {
    for (const objectType of objectTypes) {
      const element: ObjectModelElement = { objectType, properties: {} };
      let touched = false;
      for (const entry of schemaMap.entries) {
        if (entry.objectType !== objectType) continue;
        const value = item.fields[entry.sourceField];
        if (value === undefined) continue;
        touched = true;
        if (entry.propertyType === undefined) {
          element.id = value;
        } else {
          element.properties[entry.propertyType] = value;
        }
      }
      if (touched) {
        elements.push(element);
      }
    }
  }
  return elements;
}
