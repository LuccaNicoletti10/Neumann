/**
 * validation-result-notifier — src/core/types.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: tipos fundamentais do núcleo de validação proativa —
 * definição e atribuição de entidade como OBJETO ou PROPRIEDADE de objeto,
 * parâmetros ontológicos, data items importados de fonte estruturada/não
 * estruturada, condições baseadas no data source, veredito da operação de debug,
 * natureza do resultado (IMPLICIT vs EXPRESSED) e severidade.
 */

/** Como a entidade é definida/atribuída: objeto raiz ou propriedade de um objeto. */
export type EntityKind = 'object' | 'property';

/** Definição de entidade no script de transformação ou no parâmetro ontológico. */
export interface EntityDefinition {
  entity: string;
  kind: EntityKind;
  /** Obrigatório quando kind === 'property': objeto ao qual a propriedade pertence. */
  parentObject?: string;
}

/** Atribuição de entidade feita por uma condição do transformation script. */
export interface Assignment {
  entity: string;
  kind: EntityKind;
  parentObject?: string;
}

/**
 * Parâmetro ontológico: também atribui uma entidade como objeto/propriedade e
 * pode restringir os tipos de data item compatíveis com o mapping.
 */
export interface OntologyParameter {
  name: string;
  defines: EntityDefinition;
  /** Tipos de data item aceitos; ausente = aceita qualquer tipo. */
  acceptedTypes?: string[];
}

/** Data item importado de um data source (estruturado CSV/JSON ou texto livre). */
export interface DataItem {
  id: string;
  type: string;
  value: string;
  fields?: Record<string, string>;
}

/** Mapping de um data item a um parâmetro ontológico. */
export interface Mapping {
  dataItemId: string;
  parameterName: string;
}

/** Requisito que a condição impõe sobre o data source. */
export interface SourceRequirement {
  /** Campo que deve existir em todos os data items mapeados (fontes estruturadas). */
  field?: string;
  /** Tipo de data item que deve existir na fonte importada. */
  type?: string;
}

/** Condição do transformation script, baseada no data source. */
export interface Condition {
  id: string;
  description: string;
  assignment: Assignment;
  mappings: Mapping[];
  sourceRequirement?: SourceRequirement;
}

/** Códigos determinísticos de razão de invalidade. */
export type InvalidReasonCode =
  | 'entity-inconsistent'
  | 'mapping-incompatible'
  | 'data-item-missing'
  | 'source-requirement-unmet';

export interface InvalidReason {
  code: InvalidReasonCode;
  detail: string;
}

/** Veredito da operação de debug sobre uma condição. */
export interface ValidationVerdict {
  conditionId: string;
  valid: boolean;
  reasons: InvalidReason[];
}

/** Natureza do resultado: 'implicit' (não exibido) ou 'expressed' (exibido). */
export type ResultKind = 'implicit' | 'expressed';

export type Severity = 'info' | 'warning' | 'error' | 'critical';

/** Transformation script construído pelo builder. */
export interface TransformationScript {
  name: string;
  entities: EntityDefinition[];
  ontologyParameters: OntologyParameter[];
  conditions: Condition[];
}

/** Especificação de data source: estruturada (csv/json) ou não estruturada (text). */
export type DataSourceSpec =
  | { format: 'csv'; content: string }
  | { format: 'json'; content: string }
  | { format: 'text'; content: string };
