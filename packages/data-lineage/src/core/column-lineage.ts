/**
 * data-lineage — src/core/column-lineage.ts
 * Lineage colunar: dataset.column → derived.column + inherit max(inputs).
 */

import {
  columnRefKey,
  inheritClassification,
  resolveClassification,
  type ColumnLineageEdge,
  type ColumnLineageStore,
  type ColumnMarking,
  type ColumnRef,
  type RecordColumnMappingsInput,
} from 'contracts';

import type { CreateLineageStoreOptions } from './types.js';

export type CreateColumnLineageStoreOptions = CreateLineageStoreOptions;

function cloneRef(ref: ColumnRef): ColumnRef {
  return { versionId: ref.versionId, column: ref.column };
}

export function createColumnLineageStore(
  opts: CreateColumnLineageStoreOptions = {},
): ColumnLineageStore {
  const markings = new Map<string, ColumnMarking>();
  /** target key → edges inbound */
  const inbound = new Map<string, ColumnLineageEdge[]>();
  /** source key → edges outbound */
  const outbound = new Map<string, ColumnLineageEdge[]>();

  void opts;

  function getOrDefault(ref: ColumnRef): ColumnMarking {
    const key = columnRefKey(ref);
    const existing = markings.get(key);
    if (existing) return existing;
    const created: ColumnMarking = {
      versionId: ref.versionId,
      column: ref.column,
      classification: 'Unclassified',
    };
    markings.set(key, created);
    return created;
  }

  function raise(ref: ColumnRef, classification: string): boolean {
    const current = getOrDefault(ref);
    const next = resolveClassification(classification);
    const prev = resolveClassification(current.classification);
    if (next.rank <= prev.rank) return false;
    current.classification = next.name;
    return true;
  }

  function addEdge(edge: ColumnLineageEdge): void {
    const tKey = columnRefKey(edge.target);
    const sKey = columnRefKey(edge.source);
    const ins = inbound.get(tKey) ?? [];
    ins.push(edge);
    inbound.set(tKey, ins);
    const outs = outbound.get(sKey) ?? [];
    outs.push(edge);
    outbound.set(sKey, outs);
  }

  function descendants(start: ColumnRef): ColumnRef[] {
    const seen = new Set<string>([columnRefKey(start)]);
    const out: ColumnRef[] = [];
    const queue: ColumnRef[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const edge of outbound.get(columnRefKey(cur)) ?? []) {
        const k = columnRefKey(edge.target);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(cloneRef(edge.target));
        queue.push(edge.target);
      }
    }
    return out;
  }

  const store: ColumnLineageStore = {
    registerColumn(marking) {
      if (!marking.versionId) throw new Error('ColumnMarking: versionId obrigatório');
      if (!marking.column) throw new Error('ColumnMarking: column obrigatório');
      raise({ versionId: marking.versionId, column: marking.column }, marking.classification);
      return { ...getOrDefault(marking) };
    },

    recordColumnMappings(input: RecordColumnMappingsInput) {
      if (!input.pipelineRunId) throw new Error('recordColumnMappings: pipelineRunId obrigatório');
      if (!input.derivationProgramId) {
        throw new Error('recordColumnMappings: derivationProgramId obrigatório');
      }
      const edges: ColumnLineageEdge[] = [];
      for (const mapping of input.mappings) {
        if (!mapping.sources.length) {
          throw new Error('ColumnMapping: sources[] obrigatório');
        }
        const inherited = inheritClassification(
          mapping.sources.map((s) => store.effectiveColumnClassification(s)),
        );
        raise(mapping.target, inherited.name);
        for (const source of mapping.sources) {
          getOrDefault(source);
          const edge: ColumnLineageEdge = {
            source: cloneRef(source),
            target: cloneRef(mapping.target),
            pipelineRunId: input.pipelineRunId,
            derivationProgramId: input.derivationProgramId,
          };
          addEdge(edge);
          edges.push(edge);
        }
      }
      return edges;
    },

    getColumn(versionId, column) {
      const found = markings.get(columnRefKey({ versionId, column }));
      return found ? { ...found } : undefined;
    },

    columnUpstream(ref) {
      return (inbound.get(columnRefKey(ref)) ?? []).map((e) => cloneRef(e.source));
    },

    columnDownstream(ref) {
      return (outbound.get(columnRefKey(ref)) ?? []).map((e) => cloneRef(e.target));
    },

    effectiveColumnClassification(ref) {
      return resolveClassification(getOrDefault(ref).classification).name;
    },

    propagateColumnClassification(ref) {
      const sourceMark = resolveClassification(store.effectiveColumnClassification(ref));
      const affected: ColumnRef[] = [];
      for (const desc of descendants(ref)) {
        if (raise(desc, sourceMark.name)) affected.push(cloneRef(desc));
      }
      return affected;
    },

    listColumnEdges() {
      const all: ColumnLineageEdge[] = [];
      for (const edges of inbound.values()) all.push(...edges);
      return all;
    },

    listColumnMarkings() {
      return [...markings.values()].map((m) => ({ ...m }));
    },
  };

  return store;
}
