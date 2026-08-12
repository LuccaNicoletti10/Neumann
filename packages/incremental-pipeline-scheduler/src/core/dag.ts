/**
 * incremental-pipeline-scheduler — src/core/dag.ts
 * Grafo de dependências: edges source→target; ciclo; descendentes.
 */

import type { DependencyKind, PipelineDatasetDef, PipelineEdge } from 'contracts';

import type { DatasetNode } from './types.js';

export class CycleError extends Error {
  override readonly name = 'CycleError';
  constructor(message: string) {
    super(message);
  }
}

export interface DependencyGraph {
  /** id → node */
  nodes: Map<string, DatasetNode>;
  /** datasetId → ids dos quais ele depende (inputs) */
  dependencies: Map<string, string[]>;
  /** datasetId → ids que dependem dele (outputs / dependents) */
  dependents: Map<string, string[]>;
  /** groupId → member dataset ids */
  groups: Map<string, string[]>;
  groupKinds: Map<string, DependencyKind>;
}

export function createEmptyGraph(): DependencyGraph {
  return {
    nodes: new Map(),
    dependencies: new Map(),
    dependents: new Map(),
    groups: new Map(),
    groupKinds: new Map(),
  };
}

export function addDataset(
  graph: DependencyGraph,
  def: PipelineDatasetDef,
  now: string,
): DatasetNode {
  if (graph.nodes.has(def.id)) {
    throw new Error(`dataset já existe: ${def.id}`);
  }
  const node: DatasetNode = {
    id: def.id,
    name: def.name,
    kind: def.kind,
    version: 0,
    buildStatus: def.kind === 'RAW' ? 'NOT_STARTED' : 'NOT_STARTED',
    critical: def.critical === true,
    groupId: def.groupId,
    groupDependencyKind: def.groupDependencyKind,
    updatedAt: now,
    contentHash: '',
  };
  graph.nodes.set(def.id, node);
  graph.dependencies.set(def.id, []);
  graph.dependents.set(def.id, []);

  if (def.groupId) {
    const members = graph.groups.get(def.groupId) ?? [];
    members.push(def.id);
    graph.groups.set(def.groupId, members);
    if (def.groupDependencyKind) {
      graph.groupKinds.set(def.groupId, def.groupDependencyKind);
    }
  }
  return node;
}

export function addEdge(
  graph: DependencyGraph,
  edge: PipelineEdge,
): void {
  if (!graph.nodes.has(edge.sourceId) || !graph.nodes.has(edge.targetId)) {
    throw new Error(`edge com nó inexistente: ${edge.sourceId}→${edge.targetId}`);
  }
  const deps = graph.dependencies.get(edge.targetId)!;
  if (!deps.includes(edge.sourceId)) deps.push(edge.sourceId);
  const dependents = graph.dependents.get(edge.sourceId)!;
  if (!dependents.includes(edge.targetId)) dependents.push(edge.targetId);

  if (hasCycle(graph)) {
    // rollback
    deps.splice(deps.indexOf(edge.sourceId), 1);
    dependents.splice(dependents.indexOf(edge.targetId), 1);
    throw new CycleError(`ciclo detectado ao adicionar ${edge.sourceId}→${edge.targetId}`);
  }
}

export function hasCycle(graph: DependencyGraph): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const child of graph.dependents.get(id) ?? []) {
      if (dfs(child)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of graph.nodes.keys()) {
    if (dfs(id)) return true;
  }
  return false;
}

/** Descendentes transitivos (não inclui o próprio nó). Ordem BFS estável. */
export function transitiveDependents(
  graph: DependencyGraph,
  rootId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...(graph.dependents.get(rootId) ?? [])].sort();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of [...(graph.dependents.get(id) ?? [])].sort()) {
      if (!seen.has(c)) queue.push(c);
    }
  }
  return out;
}

/** Dependentes diretos, ordenados. */
export function directDependents(graph: DependencyGraph, id: string): string[] {
  return [...(graph.dependents.get(id) ?? [])].sort();
}

export function dependenciesOf(graph: DependencyGraph, id: string): string[] {
  return [...(graph.dependencies.get(id) ?? [])].sort();
}

/** Ordenação topológica dos nós (Kahn). */
export function topologicalOrder(graph: DependencyGraph): string[] {
  const indeg = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    indeg.set(id, (graph.dependencies.get(id) ?? []).length);
  }
  const queue = [...graph.nodes.keys()]
    .filter((id) => (indeg.get(id) ?? 0) === 0)
    .sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const child of [...(graph.dependents.get(id) ?? [])].sort()) {
      const next = (indeg.get(child) ?? 0) - 1;
      indeg.set(child, next);
      if (next === 0) queue.push(child);
    }
  }
  if (order.length !== graph.nodes.size) {
    throw new CycleError('ciclo na ordenação topológica');
  }
  return order;
}
