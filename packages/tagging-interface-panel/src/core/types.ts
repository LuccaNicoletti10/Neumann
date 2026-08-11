/**
 * tagging-interface-panel — src/core/types.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: TIPOS DO
 * NÚCLEO — ontologia (object types, property types com componentes, base type
 * e "representative of"), parser definitions, schema map, opções de tag,
 * campos da interface, tags, objetos tagueados, resultados de busca e pares
 * parâmetro-valor. Nenhum texto dos claims é reproduzido; apenas a
 * funcionalidade é reimplementada de forma original.
 */

/** Relógio injetável (DETERMINISMO: DateAdded sempre vem do clock). */
export type Clock = () => string;

/** Gerador de ids determinístico baseado em contadores por prefixo. */
export type IdGenerator = (prefix: string) => string;

/** Retorna um clock fixo que sempre produz o mesmo instante ISO. */
export function createFixedClock(iso: string): Clock {
  return () => iso;
}

/**
 * Retorna um clock que avança `stepMs` milissegundos a cada chamada,
 * a partir de `startIso` (aritmética determinística, sem Date.now()).
 */
export function createStepClock(startIso: string, stepMs: number): Clock {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) {
    throw new Error(`startIso inválido: ${startIso}`);
  }
  let ticks = 0;
  return () => {
    const instant = new Date(startMs + ticks * stepMs);
    ticks += 1;
    return instant.toISOString();
  };
}

/** Cria um gerador de ids determinístico: `${prefix}-${contador}`. */
export function createIdGenerator(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix: string): string => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

/** Tipo de objeto da ontologia (ex.: "Person", "Business", "Vehicle"). */
export interface ObjectType {
  name: string;
  description?: string;
}

/**
 * Tipo de propriedade da ontologia. Pode ser composta (components referenciam
 * outros property types, ex.: "Name" = "Name:First" + "Name:Last"), possui um
 * base type (ex.: "string", "number", "date") e pode ser "representative of"
 * um ou mais object types (ex.: "Social Security Number" representa "Person",
 * mas não "Business").
 */
export interface PropertyType {
  name: string;
  baseType: string;
  components: string[];
  representativeOf: string[];
}

/** Associa um token do padrão (ex.: "{LAST NAME}") a um property type. */
export interface ParserComponent {
  token: string;
  propertyType: string;
}

/**
 * Parser definition: padrão com tokens entre chaves (regex symbology) que
 * decompõe o valor de uma propriedade composta em seus componentes —
 * ex.: "{LAST NAME}, {FIRST NAME}" → Name:Last + Name:First.
 */
export interface ParserDefinition {
  name: string;
  pattern: string;
  components: ParserComponent[];
}

/** Ontologia completa do data fusion core. */
export interface Ontology {
  name: string;
  objectTypes: ObjectType[];
  propertyTypes: PropertyType[];
  parserDefinitions: ParserDefinition[];
}

/** Mapeamento de um campo da fonte para o object model (schema map). */
export interface SchemaMapEntry {
  sourceField: string;
  objectType: string;
  propertyType?: string;
}

/** Schema map: conjunto de mapeamentos fonte → object model. */
export interface SchemaMap {
  name: string;
  entries: SchemaMapEntry[];
}

/** Data item vindo de uma fonte externa. */
export interface DataItem {
  source: string;
  id: string;
  fields: Record<string, string>;
}

/** Elemento do object model produzido pelo transformation component. */
export interface ObjectModelElement {
  objectType: string;
  id?: string;
  properties: Record<string, string>;
}

/** Natureza do conteúdo externo exibido no browser. */
export type ContentKind = 'text' | 'image' | 'audio' | 'video';

/** Opções de tag do painel: property tag (404), object tag (406), link tag (408). */
export type TagOption = 'property' | 'object' | 'link';

/** Campo da tagging interface (TITLE 412, TYPE 410, campos dinâmicos de vínculo). */
export interface InterfaceField {
  id: string;
  label: string;
  value?: string;
  options?: string[];
}

/** Tag criada pelo Create Tag button (414), associada à porção selecionada. */
export interface Tag {
  id: string;
  kind: TagOption;
  title: string;
  type: string;
  contentLabel: string;
  dateAdded: string;
  user: string;
  targetObjectIds?: string[];
  targetPropertyIds?: string[];
}

/** Object tag exibido no tagged objects field (418). */
export interface TaggedObject {
  tagId: string;
  title: string;
  type: string;
  syncedObjectId?: string;
}

/** Resultado de busca de objeto já existente no internal database system. */
export interface SearchResult {
  objectId: string;
  objectType: string;
  properties: Record<string, string>;
}

/** Par parâmetro-valor coletado pela API (TagOption, Title, Type, Content, ...). */
export interface ParameterValuePair {
  parameter: string;
  value: string;
}
