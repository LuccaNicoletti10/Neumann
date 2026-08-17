/**
 * incremental-pipeline-scheduler — asset graph + staleness.
 */
import type { DatasetAsset } from 'contracts';

export interface AssetGraph {
  produces: Map<string, string[]>;
  stale: Set<string>;
  downstream: Map<string, Set<string>>;
}

export function createAssetGraph(): AssetGraph {
  return { produces: new Map(), stale: new Set(), downstream: new Map() };
}

export function declareProduces(graph: AssetGraph, transformId: string, datasets: string[]): void {
  graph.produces.set(transformId, [...datasets]);
}

export function linkAssets(graph: AssetGraph, upstream: string, downstream: string): void {
  const set = graph.downstream.get(upstream) ?? new Set();
  set.add(downstream);
  graph.downstream.set(upstream, set);
}

export function markStale(graph: AssetGraph, datasetId: string): string[] {
  const visited = new Set<string>();
  const stack = [...(graph.downstream.get(datasetId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    graph.stale.add(id);
    for (const next of graph.downstream.get(id) ?? []) stack.push(next);
  }
  return [...visited].sort();
}

export function materialize(graph: AssetGraph, datasetId: string): string[] {
  graph.stale.delete(datasetId);
  return markStale(graph, datasetId);
}

export function isStale(graph: AssetGraph, datasetId: string): boolean {
  return graph.stale.has(datasetId);
}

export function toDatasetAsset(id: string, upstreamOf: string[] = []): DatasetAsset {
  return { id, datasetId: id, upstreamOf };
}
