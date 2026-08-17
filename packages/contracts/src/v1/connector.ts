/**
 * contracts — src/v1/connector.ts
 * Connector API congelada (Passo 5). Connector NUNCA importa Ontology.
 */

import type { CanonicalEvent } from './canonical-event.js';

export type Capability = 'snapshot' | 'cdc' | 'pushdown' | 'subscribe' | 'writeback';

/** Cursor opaco persistido entre restarts. */
export interface Cursor {
  /** Token opaco (JSON serializado pelo connector). */
  token: string;
}

export interface ObjectRef {
  sourceSystem: string;
  objectName: string;
}

export interface SourceObject {
  name: string;
  sourceSystem: string;
  /** Tipo lógico opcional (table, view, topic…). */
  kind?: string;
}

export interface SourceColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
}

export interface SourceSchema {
  object: ObjectRef;
  columns: SourceColumn[];
  schemaVersion: string;
}

export type HealthState = 'ok' | 'degraded' | 'down';

export interface HealthStatus {
  state: HealthState;
  message?: string;
  checkedAt: string;
}

/**
 * Write-path (Passo 25). Connector NUNCA importa Ontology —
 * recebe campos da fonte (já inverse-mapped).
 */
export interface WriteBackRequest {
  object: ObjectRef;
  primaryKey: string;
  operation: string;
  /** Valores no schema da fonte (não PropertyType ids). */
  fields: Record<string, unknown>;
  idempotencyKey: string;
}

export interface WriteBackResult {
  ok: boolean;
  /** Registro da fonte após a escrita — usado para o object model convergir. */
  record?: Record<string, unknown>;
  error?: string;
}

/** Predicado empurrado para a fonte (Passo 31). */
export type PushdownOp = 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export interface PushdownPredicate {
  field: string;
  op: PushdownOp;
  value: unknown;
}

/**
 * Query executada na fonte — a fonte filtra/projeta; a plataforma não ingere o universo.
 */
export interface PushdownSpec {
  object: ObjectRef;
  predicates?: PushdownPredicate[];
  columns?: string[];
  primaryKeys?: string[];
  limit?: number;
}

export interface FederatedRowAcl {
  entries: Array<{ principal: string; level: 'read' | 'write' | 'admin' }>;
  /** ACL por propriedade; ausente = herda entries do fragmento. */
  propertyEntries?: Record<string, Array<{ principal: string; level: 'read' | 'write' | 'admin' }>>;
  sourceSystemId?: string;
  retrievedAt: string;
}

export interface FederatedRow {
  fragmentId: string;
  objectId: string;
  fields: Record<string, unknown>;
  lastUpdated: string;
  acl: FederatedRowAcl;
}

export interface FederatedQueryResult {
  object: ObjectRef;
  rows: FederatedRow[];
  /**
   * T1.5: false = registro consultado na fonte, não copiado para o store imutável.
   */
  copied: boolean;
  pushedDown: boolean;
}

/**
 * Contrato que toda fonte externa implementa.
 * Depende somente de `contracts` — nunca de Ontology.
 */
export interface Connector {
  readonly connectorId: string;
  readonly capabilities: ReadonlyArray<Capability>;

  discover(): Promise<SourceObject[]>;
  schema(obj: ObjectRef): Promise<SourceSchema>;
  /** Scan completo (paginado) emitindo CanonicalEvents. */
  snapshot(obj: ObjectRef): AsyncIterable<CanonicalEvent>;
  /** Leitura incremental a partir do cursor. */
  read(cursor: Cursor): AsyncIterable<CanonicalEvent>;
  checkpoint(): Promise<Cursor>;
  health(): Promise<HealthStatus>;
  /**
   * Via de retorno (US 8,930,897 / US 10,552,524).
   * Obrigatório quando `capabilities` inclui `writeback`.
   */
  writeBack?(req: WriteBackRequest): Promise<WriteBackResult>;
  /**
   * Consulta federada (US 10,402,397). Obrigatório quando `capabilities` inclui `pushdown`.
   * Não persiste no DatasetStore — o caller materializa só se pedir.
   */
  federatedQuery?(spec: PushdownSpec): Promise<FederatedQueryResult>;
  /**
   * Stream edge/remoto (Passo 32). Obrigatório quando `capabilities` inclui `subscribe`.
   * Eventos saem como CanonicalEvent — mesmo envelope da ingestão.
   */
  subscribe?(cursor?: Cursor): AsyncIterable<CanonicalEvent>;
}
