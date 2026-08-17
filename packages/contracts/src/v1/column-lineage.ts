/**
 * contracts — src/v1/column-lineage.ts
 * Lineage até coluna/property (Passo 27). Shape congelado.
 *
 * Derivação: coluna de saída herda max(colunas de entrada).
 * Kernel: arestas dataset.column → derived.column. Sem embeddings / GUI.
 */

import type { VersionId } from './dataset-store.js';
import type { DerivationProgramId, PipelineRunId } from './lineage.js';

/** Referência a uma coluna de uma versão de dataset. */
export interface ColumnRef {
  versionId: VersionId;
  column: string;
}

/** Aresta colunar: source.column → target.column. */
export interface ColumnLineageEdge {
  source: ColumnRef;
  target: ColumnRef;
  pipelineRunId: PipelineRunId;
  derivationProgramId: DerivationProgramId;
}

/** Marcação de classificação numa coluna. */
export interface ColumnMarking {
  versionId: VersionId;
  column: string;
  classification: string;
}

/** Um mapeamento n→1: várias colunas de entrada produzem uma de saída. */
export interface ColumnMapping {
  sources: ColumnRef[];
  target: ColumnRef;
}

export interface RecordColumnMappingsInput {
  pipelineRunId: PipelineRunId;
  derivationProgramId: DerivationProgramId;
  mappings: ColumnMapping[];
}

export interface ColumnLineageStore {
  /** Grava (ou sobe monotonicamente) a marcação de uma coluna. */
  registerColumn(marking: ColumnMarking): ColumnMarking;
  recordColumnMappings(input: RecordColumnMappingsInput): ColumnLineageEdge[];
  getColumn(versionId: VersionId, column: string): ColumnMarking | undefined;
  /** Inputs diretos da coluna. */
  columnUpstream(ref: ColumnRef): ColumnRef[];
  /** Outputs diretos da coluna. */
  columnDownstream(ref: ColumnRef): ColumnRef[];
  /** Classificação efetiva (própria, default Unclassified). */
  effectiveColumnClassification(ref: ColumnRef): string;
  /**
   * Descendentes herdam max(própria, fonte). Raise monotônico.
   * customers.email Confidential → enriched.customer_email Confidential.
   */
  propagateColumnClassification(ref: ColumnRef): ColumnRef[];
  listColumnEdges(): ColumnLineageEdge[];
  listColumnMarkings(): ColumnMarking[];
}

export function columnRefKey(ref: ColumnRef): string {
  return `${ref.versionId}::${ref.column}`;
}

export function parseColumnRefKey(key: string): ColumnRef {
  const idx = key.indexOf('::');
  if (idx <= 0 || idx === key.length - 2) {
    throw new Error(`ColumnRef key inválida: ${key}`);
  }
  return { versionId: key.slice(0, idx), column: key.slice(idx + 2) };
}

export function buildGoldenColumnLineageEdge(): ColumnLineageEdge {
  return {
    source: { versionId: 'customers-v1', column: 'email' },
    target: { versionId: 'orders-enriched-v1', column: 'customer_email' },
    pipelineRunId: 'run-col-1',
    derivationProgramId: 'xform-join-v1',
  };
}

export function assertColumnRef(ref: ColumnRef): void {
  if (!ref.versionId) throw new Error('ColumnRef: versionId obrigatório');
  if (!ref.column) throw new Error('ColumnRef: column obrigatório');
}

export function assertColumnLineageEdge(edge: ColumnLineageEdge): void {
  assertColumnRef(edge.source);
  assertColumnRef(edge.target);
  if (!edge.pipelineRunId) throw new Error('ColumnLineageEdge: pipelineRunId obrigatório');
  if (!edge.derivationProgramId) {
    throw new Error('ColumnLineageEdge: derivationProgramId obrigatório');
  }
}
