/**
 * contracts — src/v1/time-travel.ts
 * Time travel / multi-row tx (Passo 10). Shape congelado.
 */

/** Timestamp lógico estritamente crescente (não wall-clock). */
export type LogicalTimestamp = number;

/** Identificador de linha (table:rowKey). */
export type RowId = string;

export type TxStatus = 'ACTIVE' | 'COMMITTED' | 'ABORTED' | 'FAILED';

export interface SnapshotRequest {
  /** Nome lógico do dataset/tabela. */
  dataset: string;
  /** Instantâneo ISO (mapeado para timestamp lógico via índice) OU timestamp lógico. */
  at: string | LogicalTimestamp;
}

export interface SnapshotResult {
  dataset: string;
  at: string | LogicalTimestamp;
  logicalTimestamp: LogicalTimestamp;
  /** Mapa rowKey → column → value visível no snapshot. */
  rows: Record<string, Record<string, unknown>>;
  contentHash: string;
}

export interface ReplayResult {
  dataset: string;
  throughTimestamp: LogicalTimestamp;
  rows: Record<string, Record<string, unknown>>;
  contentHash: string;
  transactionsReplayed: number;
}

/** API mínima Passo 10 (além do DatasetStore Passo 8). */
export interface TimeTravelStore {
  snapshot(req: SnapshotRequest): SnapshotResult;
  replay(dataset: string, throughTimestamp?: LogicalTimestamp): ReplayResult;
  diffVersions(
    dataset: string,
    a: LogicalTimestamp,
    b: LogicalTimestamp,
  ): {
    a: LogicalTimestamp;
    b: LogicalTimestamp;
    addedRows: string[];
    removedRows: string[];
    changedCells: Array<{ row: string; column: string }>;
  };
}

export function buildGoldenSnapshotRequest(): SnapshotRequest {
  return {
    dataset: 'accounts',
    at: '2024-01-01T14:37:22.000Z',
  };
}
