/**
 * contracts — src/v1/lineage.ts
 * Lineage por versão (Passo 15). Shape congelado.
 *
 * US 9,996,595 — grafo dataset/version = nó, derivação = aresta; invalid flag.
 * US 9,348,879 / US20140114907 / US20150012477 / US 10,027,551 — rastreio + completude.
 */

import type { DatasetId, VersionId } from './dataset-store.js';

/** Identificador opaco de um pipeline_run / derivação. */
export type PipelineRunId = string;

/** Identificador do programa de derivação (transform SQL/DSL versionado). */
export type DerivationProgramId = string;

/** Origem vs derivado — RAW não exige inputs; DERIVED exige. */
export type LineageVersionKind = 'RAW' | 'DERIVED';

/** Registro imutável de uma execução que produziu uma versão. */
export interface PipelineRun {
  id: PipelineRunId;
  /** Versões de entrada (ordenadas, estáveis). */
  inputVersions: VersionId[];
  /** Versão de saída produzida por este run. */
  outputVersion: VersionId;
  datasetId: DatasetId;
  derivationProgramId: DerivationProgramId;
  /** Hash do conteúdo de saída (sha256 hex). */
  contentHash: string;
  /** Duração em ms. */
  durationMs: number;
  startedAt: string;
  completedAt: string;
  createdBy: string;
}

/** Aresta de derivação: sourceVersion → targetVersion. */
export interface LineageEdge {
  sourceVersion: VersionId;
  targetVersion: VersionId;
  pipelineRunId: PipelineRunId;
  derivationProgramId: DerivationProgramId;
}

/** Nó de versão no grafo de proveniência. */
export interface LineageVersionNode {
  versionId: VersionId;
  datasetId: DatasetId;
  datasetName: string;
  versionNumber: number;
  kind: LineageVersionKind;
  contentHash: string;
  /** Dirty bit — versão marcada inválida (US 9,996,595). */
  invalid: boolean;
  invalidReason?: string;
  createdAt: string;
  createdBy: string;
  /** Se RAW sem run; se DERIVED, aponta para o PipelineRun que a criou. */
  pipelineRunId?: PipelineRunId;
}

/** Nó composto: um dataset agrupando sub-entradas (versões). */
export interface CompoundLineageNode {
  datasetId: DatasetId;
  datasetName: string;
  isTarget: boolean;
  versions: LineageVersionNode[];
}

/** Grafo serializável para visualização (kernel — sem GUI). */
export interface ProvenanceGraph {
  targetVersionId: VersionId;
  nodes: CompoundLineageNode[];
  edges: LineageEdge[];
  /** Versões no conjunto de proveniência completa (upstream transitivo). */
  provenanceVersionIds: VersionId[];
}

/** Resultado do gate de completude. */
export interface LineageCompletenessReport {
  /** true se 100% dos outputs DERIVED apontam para ≥1 input. */
  complete: boolean;
  totalDerived: number;
  withInputs: number;
  /** Versões DERIVED sem input_versions. */
  orphanOutputVersions: VersionId[];
}

/** Evento de mudança de lineage (US20150012477 — notificação mínima). */
export interface LineageChangeEvent {
  kind: 'run_recorded' | 'invalidated' | 'propagated_invalid';
  versionId: VersionId;
  at: string;
  detail?: string;
}

/** Input para registrar um dataset/versão RAW (origem). */
export interface RegisterRawVersionInput {
  versionId: VersionId;
  datasetId: DatasetId;
  datasetName: string;
  versionNumber: number;
  contentHash: string;
  createdAt?: string;
  createdBy?: string;
}

/** Input para gravar um pipeline_run (derivação). */
export interface RecordPipelineRunInput {
  inputVersions: VersionId[];
  outputVersion: VersionId;
  datasetId: DatasetId;
  datasetName: string;
  versionNumber: number;
  derivationProgramId: DerivationProgramId;
  contentHash: string;
  durationMs: number;
  startedAt?: string;
  completedAt?: string;
  createdBy?: string;
}

/** Contrato LineageStore (Passo 15). */
export interface LineageStore {
  registerRaw(input: RegisterRawVersionInput): LineageVersionNode;
  recordRun(input: RecordPipelineRunInput): PipelineRun;
  getVersion(versionId: VersionId): LineageVersionNode | undefined;
  getRun(runId: PipelineRunId): PipelineRun | undefined;
  /** Inputs diretos. */
  upstream(versionId: VersionId): VersionId[];
  /** Outputs diretos. */
  downstream(versionId: VersionId): VersionId[];
  /** Proveniência completa transitiva (ancestors). */
  fullProvenance(versionId: VersionId, maxDegree?: number): VersionId[];
  /** Descendentes transitivos. */
  fullDescendants(versionId: VersionId, maxDegree?: number): VersionId[];
  /** Grafo composto para visualização. */
  visualize(versionId: VersionId, maxDegree?: number): ProvenanceGraph;
  flagInvalid(versionId: VersionId, reason: string): void;
  /** Propaga invalidação visual/lógica aos descendentes. */
  propagateInvalid(versionId: VersionId): VersionId[];
  completeness(): LineageCompletenessReport;
  listRuns(): PipelineRun[];
  listEdges(): LineageEdge[];
}

export function buildGoldenPipelineRun(): PipelineRun {
  return {
    id: 'run-1',
    inputVersions: ['ver-raw-1'],
    outputVersion: 'ver-out-1',
    datasetId: 'ds-clean',
    derivationProgramId: 'xform-clean-v1',
    contentHash: 'a'.repeat(64),
    durationMs: 42,
    startedAt: '2024-06-01T12:00:00.000Z',
    completedAt: '2024-06-01T12:00:00.042Z',
    createdBy: 'svc-pipeline',
  };
}

export function assertPipelineRun(run: PipelineRun): void {
  if (!run.id) throw new Error('PipelineRun: id obrigatório');
  if (!Array.isArray(run.inputVersions)) throw new Error('PipelineRun: inputVersions[] obrigatório');
  if (!run.outputVersion) throw new Error('PipelineRun: outputVersion obrigatório');
  if (!run.derivationProgramId) throw new Error('PipelineRun: derivationProgramId obrigatório');
  if (!run.contentHash || run.contentHash.length < 8) {
    throw new Error('PipelineRun: contentHash inválido');
  }
  if (!Number.isFinite(run.durationMs) || run.durationMs < 0) {
    throw new Error('PipelineRun: durationMs inválido');
  }
}
