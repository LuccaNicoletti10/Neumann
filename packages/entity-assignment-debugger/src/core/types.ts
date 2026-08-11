/**
 * entity-assignment-debugger — tipos centrais.
 *
 * Implementa funcionalmente (de forma original, sem copiar texto dos claims) o
 * componente da patente US 9,984,152 B2 (Palantir/Nassar, "Data Integration Tool")
 * relativo aos PARÂMETROS DE ONTOLOGIA: entidades atribuíveis como OBJETO ou como
 * PROPRIEDADE de um objeto (com tipos), links entre entidades, data items
 * importados, mappings data item → parâmetro e condições avaliadas pela operação
 * de depuração do transformation script.
 */

/** Natureza de uma entidade: objeto independente ou propriedade de um objeto. */
export type EntityKind = 'object' | 'property';

/**
 * DEFINIÇÃO de entidade produzida pelo builder do transformation script.
 * Para 'object', `properties` lista as propriedades (nome → tipo de valor).
 * Para 'property', `owner` é o objeto dono e `valueType` o tipo do valor.
 */
export interface EntityDef {
  kind: EntityKind;
  name: string;
  owner?: string;
  valueType?: string;
  properties?: Record<string, string>;
}

/**
 * ATRIBUIÇÃO de entidade feita pela ontologia.
 * Espelha EntityDef: a ontologia atribui cada entidade como objeto ou como
 * propriedade de um objeto (com tipos).
 */
export interface EntityAssignment {
  kind: EntityKind;
  name: string;
  owner?: string;
  valueType?: string;
  properties?: Record<string, string>;
}

/** Link entre duas entidades (criado no builder / atribuído na ontologia). */
export interface Link {
  name: string;
  from: string;
  to: string;
}

/** Data item importado de uma fonte de dados (estruturada ou não estruturada). */
export interface DataItem {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Mapping de (uma porção de) um data item para um parâmetro da ontologia:
 * o campo `dataItemField` alimenta o parâmetro `parameter` da entidade `entity`.
 */
export interface Mapping {
  dataItemField: string;
  entity: string;
  parameter: string;
  dataItemId?: string;
}

/**
 * Condição do transformation script que usa um data item importado.
 * `entity` é a entidade cuja consistência (atribuição × definição) será avaliada;
 * `links` são links usados pela condição; `dataItemId` o data item consumido.
 */
export interface Condition {
  id: string;
  entity: string;
  links?: string[];
  dataItemId?: string;
}

/** Transformation script construído pelo builder (serializável em JSON). */
export interface TransformationScript {
  name: string;
  definitions: EntityDef[];
  links: Link[];
  mappings: Mapping[];
  conditions: Condition[];
}

/**
 * Tipo de resultado da operação de depuração:
 * - 'invalid':   condição inválida — resultado EXPRESSED no display device;
 * - 'implicit':  condição válida com condição subsequente — resultado IMPLICIT (silencioso);
 * - 'validated': condição válida sem subsequentes — EXPRESSED "transformation script has been validated".
 */
export type DebugOutcomeKind = 'invalid' | 'implicit' | 'validated';

/** Resultado individual da avaliação de uma condição. */
export interface DebugOutcome {
  conditionId: string;
  kind: DebugOutcomeKind;
  valid: boolean;
  /** true quando o resultado é EXPRESSED no display device. */
  expressed: boolean;
  message: string;
  reasons: string[];
}

/** Relatório agregado de uma operação de depuração. */
export interface DebugReport {
  success: boolean;
  outcomes: DebugOutcome[];
}
