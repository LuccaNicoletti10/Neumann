/**
 * tagging-interface-panel — src/core/ontology.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: BUILDER DA
 * ONTOLOGIA DO DATA FUSION CORE — registra object types, property types (com
 * componentes, base type e vínculo "representative of" a object types) e
 * parser definitions; expõe isRepresentative para consultar se um property
 * type representa um object type. Nenhum texto dos claims é reproduzido;
 * apenas a funcionalidade é reimplementada de forma original.
 */

import type {
  ObjectType,
  Ontology,
  ParserDefinition,
  PropertyType,
} from './types.js';

/** Entrada para registro de um property type. */
export interface PropertyTypeInput {
  name: string;
  baseType?: string;
  components?: string[];
  representativeOf?: string[];
}

/** Builder determinístico da ontologia do data fusion core. */
export class OntologyBuilder {
  private readonly objectTypes = new Map<string, ObjectType>();
  private readonly propertyTypes = new Map<string, PropertyType>();
  private readonly parserDefinitions = new Map<string, ParserDefinition>();

  constructor(readonly name: string) {}

  /** Registra um object type (idempotente por nome). */
  addObjectType(name: string, description?: string): this {
    if (!this.objectTypes.has(name)) {
      this.objectTypes.set(name, description === undefined ? { name } : { name, description });
    }
    return this;
  }

  /**
   * Registra um property type. `representativeOf` lista os object types que o
   * property type representa (ex.: "Social Security Number" → ["Person"]).
   * `components` lista os property types componentes de uma propriedade
   * composta (ex.: "Name" → ["Name:Last", "Name:First"]).
   */
  addPropertyType(input: PropertyTypeInput): this {
    if (!this.propertyTypes.has(input.name)) {
      this.propertyTypes.set(input.name, {
        name: input.name,
        baseType: input.baseType ?? 'string',
        components: [...(input.components ?? [])],
        representativeOf: [...(input.representativeOf ?? [])],
      });
    }
    return this;
  }

  /** Registra uma parser definition (idempotente por nome). */
  addParserDefinition(definition: ParserDefinition): this {
    if (!this.parserDefinitions.has(definition.name)) {
      this.parserDefinitions.set(definition.name, {
        name: definition.name,
        pattern: definition.pattern,
        components: definition.components.map((c) => ({ ...c })),
      });
    }
    return this;
  }

  /** Materializa a ontologia (cópias defensivas, ordem de inserção). */
  build(): Ontology {
    return {
      name: this.name,
      objectTypes: [...this.objectTypes.values()].map((o) => ({ ...o })),
      propertyTypes: [...this.propertyTypes.values()].map((p) => ({
        name: p.name,
        baseType: p.baseType,
        components: [...p.components],
        representativeOf: [...p.representativeOf],
      })),
      parserDefinitions: [...this.parserDefinitions.values()].map((d) => ({
        name: d.name,
        pattern: d.pattern,
        components: d.components.map((c) => ({ ...c })),
      })),
    };
  }
}

/** Cria um builder de ontologia com o nome informado. */
export function createOntologyBuilder(name: string): OntologyBuilder {
  return new OntologyBuilder(name);
}

/**
 * Consulta se um property type é "representative of" um object type —
 * ex.: isRepresentative(ont, 'Social Security Number', 'Person') === true,
 * enquanto ('Social Security Number', 'Business') === false.
 */
export function isRepresentative(
  ontology: Ontology,
  propertyTypeName: string,
  objectTypeName: string,
): boolean {
  const propertyType = ontology.propertyTypes.find((p) => p.name === propertyTypeName);
  if (propertyType === undefined) return false;
  return propertyType.representativeOf.includes(objectTypeName);
}

/** Busca um property type pelo nome. */
export function findPropertyType(
  ontology: Ontology,
  propertyTypeName: string,
): PropertyType | undefined {
  return ontology.propertyTypes.find((p) => p.name === propertyTypeName);
}

/** Busca um object type pelo nome. */
export function findObjectType(
  ontology: Ontology,
  objectTypeName: string,
): ObjectType | undefined {
  return ontology.objectTypes.find((o) => o.name === objectTypeName);
}
