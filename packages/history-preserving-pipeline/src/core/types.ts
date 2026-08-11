/**
 * history-preserving-pipeline — src/core/types.ts
 * Tipos internos (ISO strings; sem Date no núcleo).
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export type TransactionStatus = 'OPEN' | 'COMMITTED' | 'ABORTED';

/** Container de dados content-addressed. */
export interface DataContainer {
  contentHash: string;
  contentRef: string;
  bytes: Buffer;
  mediaType?: string;
}

/** Programa de derivação registrado no build catalog. */
export interface DerivationProgram {
  id: string;
  name: string;
  inputDatasetIds: string[];
  outputDatasetId: string;
  schemaVersion: string;
}

/** Entrada no build catalog (uma build bem-sucedida). */
export interface BuildCatalogEntry {
  id: string;
  programId: string;
  inputVersionIds: string[];
  outputVersionId: string;
  contentHash: string;
  builtAt: string;
}

/** Transformação pura: payloads das entradas (na ordem dos inputDatasetIds) → payload de saída. */
export type DerivationFn = (inputs: unknown[]) => unknown;

export interface PipelineDeps {
  clock: Clock;
  nextId: IdGenerator;
}
