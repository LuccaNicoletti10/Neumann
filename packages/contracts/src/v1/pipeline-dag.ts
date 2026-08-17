/**
 * contracts — src/v1/pipeline-dag.ts
 * DAG + scheduler incremental (Passo 12 / US 11,314,698). Shape congelado.
 */

export type DatasetKind = 'RAW' | 'DERIVED';

export type BuildStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED';

export type DependencyKind =
  | 'DIRECT'
  | 'INDIRECT'
  | 'NON_DIRECTIONAL_GROUP'
  | 'DIRECTIONAL_GROUP';

/** Declaração de nó no grafo (inputs/outputs via arestas). */
export interface PipelineDatasetDef {
  id: string;
  name: string;
  kind: DatasetKind;
  critical?: boolean;
  groupId?: string;
  groupDependencyKind?: DependencyKind;
}

/** Aresta: source → target (target depende de source). */
export interface PipelineEdge {
  sourceId: string;
  targetId: string;
  kind?: DependencyKind;
}

/** Job de build de um dataset derivado. */
export interface BuildJobSpec {
  id: string;
  targetDatasetId: string;
  sourceDatasetIds: string[];
  status: BuildStatus;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  reason: 'arrival' | 'cutoff_full' | 'manual';
}

/** Resultado de um ciclo de scheduling após um commit/arrival. */
export interface ScheduleTickResult {
  arrivedDatasetId: string;
  /** Descendentes diretos considerados. */
  dependentIds: string[];
  /** Jobs enfileirados/iniciados neste tick. */
  enqueuedJobIds: string[];
  /** Marcados partial (faltam inputs). */
  partialDependencyIds: string[];
  /** Datasets realmente rebuilt (COMPLETED neste tick, ordem topológica). */
  rebuiltDatasetIds: string[];
}

export interface DatasetAsset {
  id: string;
  datasetId: string;
  upstreamOf?: string[];
}

export type SensorKind = 'dataset_changed' | 'cron' | 'webhook';

export interface SensorDef {
  id: string;
  kind: SensorKind;
  target: string;
  cron?: string;
  datasetId?: string;
}

export function buildGoldenPipelineEdge(): PipelineEdge {
  return { sourceId: 'R1', targetId: 'D1', kind: 'DIRECT' };
}
