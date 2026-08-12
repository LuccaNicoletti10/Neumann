/**
 * incremental-pipeline-scheduler — src/core/scheduler.ts
 * Blocks 18–28: arrival → subset de dependents → build só se inputs prontos.
 */

import type {
  BuildJobSpec,
  PipelineDatasetDef,
  PipelineEdge,
  ScheduleTickResult,
} from 'contracts';

import {
  addDataset,
  addEdge,
  createEmptyGraph,
  dependenciesOf,
  directDependents,
  topologicalOrder,
  transitiveDependents,
  type DependencyGraph,
} from './dag.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { hashCanonical } from './hash.js';
import type {
  BuildHandler,
  Clock,
  CreateSchedulerOptions,
  DatasetNode,
  IdGenerator,
} from './types.js';

export interface IncrementalPipelineScheduler {
  addDataset(def: PipelineDatasetDef): DatasetNode;
  addEdge(edge: PipelineEdge): void;
  getDataset(id: string): DatasetNode | undefined;
  listDatasets(): DatasetNode[];
  /** Marca RAW (ou qualquer) como chegado/commitado e agenda rebuilds afetados. */
  commitArrival(datasetId: string, payload?: unknown): ScheduleTickResult;
  /** Após cutoff: build de todos DERIVED ainda não COMPLETED (criticos notificados). */
  runCutoffFullBuild(): {
    rebuiltDatasetIds: string[];
    criticalMissing: string[];
    jobIds: string[];
  };
  setCutoffReached(reached: boolean): void;
  isCutoffReached(): boolean;
  getJobs(): BuildJobSpec[];
  /** Gate helper: ids rebuilt após uma sequência de arrivals. */
  rebuiltInLastTick(): string[];
  dependentsOf(id: string): string[];
  transitiveDependentsOf(id: string): string[];
  hasArrived(id: string): boolean;
  markCritical(id: string): void;
  addToGroup(
    groupId: string,
    datasetId: string,
    kind: 'NON_DIRECTIONAL_GROUP' | 'DIRECTIONAL_GROUP',
  ): void;
}

const defaultBuild: BuildHandler = ({ target, sources }) => ({
  contentHash: hashCanonical({
    target: target.id,
    version: target.version + 1,
    sources: sources.map((s) => ({ id: s.id, v: s.version, h: s.contentHash })),
  }),
});

export function createIncrementalPipelineScheduler(
  options: CreateSchedulerOptions = {},
): IncrementalPipelineScheduler {
  const clock: Clock = options.clock ?? createDeterministicClock();
  const nextId: IdGenerator = options.nextId ?? createIdGenerator();
  const build = options.build ?? defaultBuild;
  const graph: DependencyGraph = createEmptyGraph();
  const jobs: BuildJobSpec[] = [];
  const partial = new Set<string>();
  let cutoffReached = false;
  let lastRebuilt: string[] = [];

  function requireNode(id: string): DatasetNode {
    const n = graph.nodes.get(id);
    if (!n) throw new Error(`dataset inexistente: ${id}`);
    return n;
  }

  function inputsReady(targetId: string): boolean {
    for (const depId of dependenciesOf(graph, targetId)) {
      const dep = graph.nodes.get(depId);
      if (!dep || dep.buildStatus !== 'COMPLETED') return false;
    }
    return true;
  }

  function enqueueBuild(
    targetId: string,
    reason: BuildJobSpec['reason'],
  ): BuildJobSpec | null {
    const target = requireNode(targetId);
    if (target.kind !== 'DERIVED') return null;
    if (!inputsReady(targetId)) {
      partial.add(targetId);
      target.buildStatus = 'PENDING';
      return null;
    }
    partial.delete(targetId);

    const sources = dependenciesOf(graph, targetId).map((id) => requireNode(id));
    const job: BuildJobSpec = {
      id: nextId('job'),
      targetDatasetId: targetId,
      sourceDatasetIds: sources.map((s) => s.id),
      status: 'IN_PROGRESS',
      scheduledAt: clock(),
      startedAt: clock(),
      reason,
    };

    target.buildStatus = 'IN_PROGRESS';
    const { contentHash } = build({ target, sources, clock });
    target.version += 1;
    target.contentHash = contentHash;
    target.updatedAt = clock();
    target.buildStatus = 'COMPLETED';
    job.status = 'COMPLETED';
    job.completedAt = clock();
    jobs.push(job);
    return job;
  }

  /**
   * Após um arrival, tenta build dos dependents diretos e propaga em ordem
   * topológica apenas dentro do subgrafo afetado.
   */
  function scheduleFromArrival(arrivedId: string): ScheduleTickResult {
    const dependentIds = directDependents(graph, arrivedId);
    const affected = new Set<string>([
      ...dependentIds,
      ...transitiveDependents(graph, arrivedId),
    ]);

    // Ordem topológica global filtrada ao subgrafo afetado
    const order = topologicalOrder(graph).filter((id) => affected.has(id));

    const enqueuedJobIds: string[] = [];
    const partialDependencyIds: string[] = [];
    const rebuiltDatasetIds: string[] = [];

    for (const id of order) {
      const node = requireNode(id);
      if (node.kind !== 'DERIVED') continue;
      if (!affected.has(id)) continue;

      if (!inputsReady(id)) {
        partial.add(id);
        node.buildStatus = 'PENDING';
        partialDependencyIds.push(id);
        continue;
      }

      // Só rebuild se algum input mudou desde o último build do target
      // (neste kernel: se está PENDING/NOT_STARTED/FAILED ou qualquer input
      // updatedAt >= target.updatedAt quando target já COMPLETED — simplificado:
      // rebuild sempre que inputs ready e (não COMPLETED OU chegou ancestor neste tick).
      const job = enqueueBuild(id, 'arrival');
      if (job) {
        enqueuedJobIds.push(job.id);
        rebuiltDatasetIds.push(id);
      } else {
        partialDependencyIds.push(id);
      }
    }

    lastRebuilt = [...rebuiltDatasetIds];
    return {
      arrivedDatasetId: arrivedId,
      dependentIds,
      enqueuedJobIds,
      partialDependencyIds: [...new Set(partialDependencyIds)].sort(),
      rebuiltDatasetIds,
    };
  }

  return {
    addDataset(def) {
      return addDataset(graph, def, clock());
    },
    addEdge(edge) {
      addEdge(graph, edge);
    },
    getDataset(id) {
      return graph.nodes.get(id);
    },
    listDatasets() {
      return [...graph.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    commitArrival(datasetId, payload) {
      if (cutoffReached) {
        // Cutoff mode: full build path is separate; arrivals still mark complete
      }
      const node = requireNode(datasetId);
      node.buildStatus = 'COMPLETED';
      node.version += 1;
      node.contentHash =
        payload !== undefined
          ? hashCanonical(payload)
          : hashCanonical({ id: node.id, version: node.version });
      node.updatedAt = clock();

      return scheduleFromArrival(datasetId);
    },
    runCutoffFullBuild() {
      cutoffReached = true;
      const criticalMissing: string[] = [];
      const rebuiltDatasetIds: string[] = [];
      const jobIds: string[] = [];

      for (const id of topologicalOrder(graph)) {
        const node = requireNode(id);
        if (node.kind !== 'DERIVED') continue;
        if (node.buildStatus === 'COMPLETED') continue;
        if (node.critical && !inputsReady(id)) {
          criticalMissing.push(id);
        }
        const job = enqueueBuild(id, 'cutoff_full');
        if (job) {
          jobIds.push(job.id);
          rebuiltDatasetIds.push(id);
        }
      }
      lastRebuilt = [...rebuiltDatasetIds];
      return { rebuiltDatasetIds, criticalMissing, jobIds };
    },
    setCutoffReached(reached) {
      cutoffReached = reached;
    },
    isCutoffReached() {
      return cutoffReached;
    },
    getJobs() {
      return jobs.map((j) => ({ ...j, sourceDatasetIds: [...j.sourceDatasetIds] }));
    },
    rebuiltInLastTick() {
      return [...lastRebuilt];
    },
    dependentsOf(id) {
      return directDependents(graph, id);
    },
    transitiveDependentsOf(id) {
      return transitiveDependents(graph, id);
    },
    hasArrived(id) {
      return requireNode(id).buildStatus === 'COMPLETED';
    },
    markCritical(id) {
      requireNode(id).critical = true;
    },
    addToGroup(groupId, datasetId, kind) {
      const node = requireNode(datasetId);
      node.groupId = groupId;
      node.groupDependencyKind = kind;
      const members = graph.groups.get(groupId) ?? [];
      if (!members.includes(datasetId)) members.push(datasetId);
      graph.groups.set(groupId, members);
      graph.groupKinds.set(groupId, kind);
    },
  };
}
