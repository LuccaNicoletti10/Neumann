/**
 * contracts — src/v1/connector.ts
 * Connector API congelada (Passo 5). Connector NUNCA importa Ontology.
 */

import type { CanonicalEvent } from './canonical-event.js';

export type Capability = 'snapshot' | 'cdc' | 'pushdown' | 'subscribe';

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
}
