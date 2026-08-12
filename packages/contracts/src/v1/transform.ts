/**
 * contracts — src/v1/transform.ts
 * Transformation runner / DSL (Passo 11). Shape congelado.
 */

/** Status de execução incremental (patentes DSL). */
export type IncrementalStatus = 'FULL' | 'INCREMENTAL';

/** Como a transformação pode recomputar com append. */
export type IncrementalComputability =
  | 'CONCATENATE'
  | 'MERGE_AND_APPEND'
  | 'MERGE_AND_REPLACE'
  | 'IMPOSSIBLE';

export type TransformOpKind =
  | 'filter'
  | 'join'
  | 'sort'
  | 'aggregate'
  | 'drop'
  | 'rename'
  | 'distinct'
  | 'select'
  | 'custom';

/** Uma etapa do pipeline DSL. */
export interface TransformStep {
  kind: TransformOpKind;
  /** Params tipados por kind (column, values, leftKey, …). */
  params: Record<string, unknown>;
  /** SQL equivalente (versionado junto com o programa). */
  sqlFragment?: string;
}

/** Programa de transformação versionado. */
export interface TransformProgram {
  id: string;
  name: string;
  version: number;
  /** Tabela/dataset de partida. */
  startWith: string;
  steps: TransformStep[];
  /** SQL completo materializado (determinístico a partir dos steps). */
  sql: string;
  createdAt: string;
  incrementalStatus: IncrementalStatus;
  computability: IncrementalComputability;
}

/** Resultado de uma execução. */
export interface TransformRunResult {
  programId: string;
  programVersion: number;
  rowCount: number;
  /** sha256 do JSON canônico das rows (gate de determinismo). */
  contentHash: string;
  rows: Record<string, unknown>[];
  sql: string;
  mode: IncrementalStatus;
}

export function buildGoldenTransformStep(): TransformStep {
  return {
    kind: 'filter',
    params: { column: 'status', values: ['active'] },
    sqlFragment: "WHERE status IN ('active')",
  };
}
