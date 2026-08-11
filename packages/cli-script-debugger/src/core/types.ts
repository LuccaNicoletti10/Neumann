/**
 * cli-script-debugger — src/core/types.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: TIPOS DO NÚCLEO DE VALIDAÇÃO —
 * entidade definida como OBJETO ou PROPRIEDADE de objeto, data items
 * importados de data source, condição baseada no data source, veredito do
 * debugging, indicação do resultado (implicit/expressed) e arquivo de
 * configuração que identifica o ontology file. Nenhum texto dos claims é
 * reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

/** Como uma entidade é definida no script / atribuída na ontologia. */
export type EntityKind = 'object' | 'property';

/** Definição de entidade no transformation script (objeto ou propriedade de objeto). */
export interface EntityDef {
  kind: EntityKind;
  objectType: string;
  property?: string;
}

/** Atribuição de entidade feita pela ontologia para um ontology parameter. */
export interface EntityAssignment {
  kind: EntityKind;
  objectType: string;
  property?: string;
}

/** Data item importado de uma data source estruturada (CSV) ou não estruturada (texto). */
export interface DataItem {
  source: 'csv' | 'text';
  id: string;
  line: number;
  fields: Record<string, string>;
}

/** Tipos de condição avaliáveis sobre o data source. */
export type ConditionType = 'equals' | 'contains' | 'numericRange' | 'fieldPresent';

/** Condição baseada no data source. */
export interface Condition {
  dataSource: string;
  type: ConditionType;
  expected?: string;
  min?: number;
  max?: number;
}

/** Mapeamento de um campo de data item para um ontology parameter. */
export interface Mapping {
  entity: string;
  dataField: string;
  parameter: string;
}

/** Definição serializável do transformation script. */
export interface ScriptDefinition {
  name: string;
  entities: Record<string, EntityDef>;
  conditions: Condition[];
  mappings: Mapping[];
}

/** Parâmetro da ontologia com sua atribuição de entidade. */
export interface OntologyParameter {
  name: string;
  entity: string;
  assignment: EntityAssignment;
}

/** Ontologia carregada do ontology file. */
export interface Ontology {
  name: string;
  parameters: OntologyParameter[];
}

/** Códigos de problema detectáveis pelo debugging. */
export type IssueCode =
  | 'UNKNOWN_ENTITY'
  | 'INCONSISTENT_ASSIGNMENT'
  | 'INVALID_MAPPING'
  | 'INVALID_CONDITION';

/** Problema encontrado durante o debugging. */
export interface VerdictIssue {
  code: IssueCode;
  message: string;
  entity?: string;
  parameter?: string;
}

/** Resultado da operação de debug. */
export interface Verdict {
  valid: boolean;
  issues: VerdictIssue[];
  stats: { items: number; evaluated: number; failed: number };
}

/** Indicação do resultado: implícita (válido) ou expressa (inválido). */
export type IndicationKind = 'implicit' | 'expressed';

/** Formas de indicação expressa: error message, acronym, number ou graphic. */
export type IndicationForm = 'message' | 'acronym' | 'number' | 'graphic';

/** Indicação emitida ao final do debugging. */
export interface Indication {
  kind: IndicationKind;
  form: IndicationForm;
  content: string;
}

/** Canais de entrega da indicação (sinks injetáveis). */
export type SinkChannel = 'debugger' | 'email' | 'popup';

/** Arquivo de configuração que associa o script ao ontology file. */
export interface DebugConfigFile {
  scriptFile: string;
  ontologyFile: string;
  dataFile: string;
  dataFormat: 'csv' | 'text';
  mode?: 'eager' | 'lazy';
  indication?: { form?: IndicationForm; sink?: SinkChannel };
}

/** Configuração de debug com caminhos já resolvidos e defaults aplicados. */
export interface DebugConfig {
  configDir: string;
  scriptFile: string;
  ontologyFile: string;
  dataFile: string;
  dataFormat: 'csv' | 'text';
  mode: 'eager' | 'lazy';
  indication: { form: IndicationForm; sink: SinkChannel };
}
