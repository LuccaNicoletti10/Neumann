/**
 * contracts — src/v1/delta-tree.ts
 * Delta tree / compactação (Passo 9). Shape congelado para gates TM1.5+.
 */

/** Tipo de nó na árvore de deltas. */
export type DeltaKind = 'full' | 'delta' | 'combined';

/** Referência content-addressed a um blob de delta. */
export interface DeltaRef {
  contentRef: string;
  contentHash: string;
  kind: DeltaKind;
}

/** Operação de delta sobre objeto JSON (path com pontos). */
export type DeltaOp =
  | { type: 'update'; path: string; value: unknown }
  | { type: 'delete'; path: string }
  | { type: 'add'; key: string; value: unknown };

/** Delta individual Δn contra o estado anterior. */
export interface IndividualDelta {
  id: string;
  /** Número monotônico 1..N. */
  updateNumber: number;
  dataItemId: string;
  ops: DeltaOp[];
  /** sha256 canônico do payload (ops). */
  checksum: string;
  createdAt: string;
  kind: 'delta';
}

/** Delta combinado hierárquico (ex.: Δ1–10, Δ1–100). */
export interface CombinedDelta {
  id: string;
  level: number;
  startUpdate: number;
  endUpdate: number;
  width: number;
  dataItemId: string;
  /** Ops equivalentes a aplicar Δstart..Δend em sequência. */
  ops: DeltaOp[];
  checksum: string;
  createdAt: string;
  kind: 'combined';
  /** Ids dos filhos (individuais no L1, combined no L>1). */
  childrenIds: string[];
}

/** BASE (snapshot full). */
export interface BaseSnapshot {
  id: string;
  dataItemId: string;
  /** Estado canônico serializado (JSON). */
  payload: unknown;
  checksum: string;
  createdAt: string;
  kind: 'full';
}

/** Conjunto mínimo para reconstruir até targetUpdate. */
export interface MinimalDeltaSet {
  baseId: string;
  combined: CombinedDelta[];
  individuals: IndividualDelta[];
  targetUpdate: number;
}

/** Fixture dourada de DeltaOp (shape). */
export function buildGoldenDeltaOps(): DeltaOp[] {
  return [
    { type: 'update', path: 'age', value: 31 },
    { type: 'add', key: 'city', value: 'SF' },
  ];
}
