/**
 * schema-registry — src/core/types.ts
 *
 * Schema registry + classificador de drift (PASSO 7 / TM1.4) e descoberta
 * automática de schema de fontes novas (US 9,330,120). Reimplementação
 * funcional independente — nenhum texto de claims é reproduzido.
 */

/** Tipos físicos normalizados no registry. */
export type PhysicalType =
  | 'boolean'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'string'
  | 'date'
  | 'datetime'
  | 'json'
  | 'unknown';

/** Classificação de drift entre schema registrado e observado. */
export type DriftKind = 'compatible' | 'coercible' | 'breaking' | 'unknown';

/** Ação tomada (ou recomendada) após classificar o drift. */
export type DriftAction = 'accept' | 'accept_with_cast' | 'pause_and_alert';

/** Relógio injetável (determinismo total). */
export type Clock = () => string;

/** Gerador de ids injetável. */
export type IdGenerator = (prefix: string) => string;

/** Coluna registrada no schema registry. */
export interface ColumnSchema {
  column: string;
  physicalType: PhysicalType;
  semanticHint?: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  foreignKeys: string[];
  observedValuesSample: string[];
  firstSeen: string;
  lastSeen: string;
}

/** Snapshot de schema de um objeto (tabela) numa fonte. */
export interface ObjectSchema {
  source: string;
  object: string;
  schemaVersion: number;
  columns: ColumnSchema[];
  paused: boolean;
  pauseReason?: string;
  updatedAt: string;
}

/** Entrada de observação (sem metadados de versão — usada em discover/observe). */
export interface ObservedColumn {
  column: string;
  physicalType: PhysicalType;
  semanticHint?: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  foreignKeys?: string[];
  sampleValues?: string[];
}

/** Schema observado numa ingestão (ainda não classificado). */
export interface ObservedSchema {
  source: string;
  object: string;
  columns: ObservedColumn[];
  observedAt?: string;
}

/** Mudança granular numa coluna. */
export type ColumnChangeKind =
  | 'added'
  | 'removed'
  | 'type_widened'
  | 'type_narrowed'
  | 'type_unknown'
  | 'nullability_relaxed'
  | 'nullability_tightened'
  | 'pk_changed'
  | 'unchanged';

export interface ColumnChange {
  column: string;
  kind: ColumnChangeKind;
  fromType?: PhysicalType;
  toType?: PhysicalType;
  fromNullable?: boolean;
  toNullable?: boolean;
}

/** Resultado do classificador de drift. */
export interface DriftReport {
  source: string;
  object: string;
  kind: DriftKind;
  action: DriftAction;
  changes: ColumnChange[];
  registeredVersion: number;
  /** Casts a registrar quando kind === coercible. */
  casts: TypeCast[];
  detail: string;
  at: string;
}

/** Cast registrado para widening coercível. */
export interface TypeCast {
  column: string;
  fromType: PhysicalType;
  toType: PhysicalType;
}

/** Alerta emitido em breaking/unknown. */
export interface SchemaAlert {
  id: string;
  source: string;
  object: string;
  kind: DriftKind;
  detail: string;
  changes: ColumnChange[];
  at: string;
  acknowledged: boolean;
}

/** Tipo de objeto da ontologia (importação assistida). */
export interface OntologyPropertyDef {
  name: string;
  physicalType: PhysicalType;
  required?: boolean;
  hint?: string;
}

export interface OntologyObjectDef {
  name: string;
  properties: OntologyPropertyDef[];
}

/** Sugestão de mapeamento schema → propriedade da ontologia. */
export interface MappingSuggestion {
  column: string;
  objectType: string;
  property: string;
  score: number;
  reason: string;
}

export class CoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CoreError';
  }
}
