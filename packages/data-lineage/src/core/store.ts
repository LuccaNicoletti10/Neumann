/**
 * data-lineage — src/core/store.ts
 * LineageStore em memória: pipeline_run → arestas; upstream/downstream; completude.
 */

import {
  assertPipelineRun,
  inheritClassification,
  resolveClassification,
  type CompoundLineageNode,
  type LineageChangeEvent,
  type LineageCompletenessReport,
  type LineageEdge,
  type LineageStore,
  type LineageVersionNode,
  type PipelineRun,
  type ProvenanceGraph,
  type RecordPipelineRunInput,
  type RegisterRawVersionInput,
  type VersionId,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import type { CreateLineageStoreOptions } from './types.js';

export function createLineageStore(opts: CreateLineageStoreOptions = {}): LineageStore {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const onChange = opts.onChange;

  const versions = new Map<VersionId, LineageVersionNode>();
  const runs = new Map<string, PipelineRun>();
  /** target → sources */
  const inbound = new Map<VersionId, LineageEdge[]>();
  /** source → targets */
  const outbound = new Map<VersionId, LineageEdge[]>();

  function emit(event: LineageChangeEvent): void {
    onChange?.(event);
  }

  function addEdge(edge: LineageEdge): void {
    const ins = inbound.get(edge.targetVersion) ?? [];
    ins.push(edge);
    inbound.set(edge.targetVersion, ins);

    const outs = outbound.get(edge.sourceVersion) ?? [];
    outs.push(edge);
    outbound.set(edge.sourceVersion, outs);
  }

  function walk(
    start: VersionId,
    neighbors: (id: VersionId) => VersionId[],
    maxDegree: number,
  ): VersionId[] {
    const out: VersionId[] = [];
    const seen = new Set<VersionId>([start]);
    const queue: Array<{ id: VersionId; degree: number }> = [{ id: start, degree: 0 }];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.degree >= maxDegree) continue;
      for (const n of neighbors(cur.id)) {
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
        queue.push({ id: n, degree: cur.degree + 1 });
      }
    }
    return out;
  }

  const store: LineageStore = {
    registerRaw(input: RegisterRawVersionInput): LineageVersionNode {
      if (versions.has(input.versionId)) {
        throw new Error(`versão já registrada: ${input.versionId}`);
      }
      if (!input.contentHash || input.contentHash.length < 8) {
        throw new Error('registerRaw: contentHash inválido');
      }
      const node: LineageVersionNode = {
        versionId: input.versionId,
        datasetId: input.datasetId,
        datasetName: input.datasetName,
        versionNumber: input.versionNumber,
        kind: 'RAW',
        contentHash: input.contentHash,
        invalid: false,
        createdAt: input.createdAt ?? clock(),
        createdBy: input.createdBy ?? 'system',
        classification: resolveClassification(input.classification).name,
      };
      versions.set(input.versionId, node);
      return node;
    },

    recordRun(input: RecordPipelineRunInput): PipelineRun {
      if (versions.has(input.outputVersion)) {
        throw new Error(`output já existe: ${input.outputVersion}`);
      }
      if (!input.inputVersions.length) {
        throw new Error('recordRun: DERIVED exige inputVersions[] não vazio');
      }
      for (const iv of input.inputVersions) {
        if (!versions.has(iv)) {
          throw new Error(`input versão desconhecida: ${iv}`);
        }
      }

      const startedAt = input.startedAt ?? clock();
      const completedAt =
        input.completedAt ??
        new Date(Date.parse(startedAt) + input.durationMs).toISOString();

      const run: PipelineRun = {
        id: nextId('run'),
        inputVersions: [...input.inputVersions],
        outputVersion: input.outputVersion,
        datasetId: input.datasetId,
        derivationProgramId: input.derivationProgramId,
        contentHash: input.contentHash,
        durationMs: input.durationMs,
        startedAt,
        completedAt,
        createdBy: input.createdBy ?? 'svc-pipeline',
      };
      assertPipelineRun(run);

      const inherited = inheritClassification(
        input.inputVersions.map((id) => versions.get(id)?.classification),
      );
      const node: LineageVersionNode = {
        versionId: input.outputVersion,
        datasetId: input.datasetId,
        datasetName: input.datasetName,
        versionNumber: input.versionNumber,
        kind: 'DERIVED',
        contentHash: input.contentHash,
        invalid: false,
        createdAt: completedAt,
        createdBy: run.createdBy,
        pipelineRunId: run.id,
        classification: inherited.name,
      };

      versions.set(input.outputVersion, node);
      runs.set(run.id, run);

      for (const src of input.inputVersions) {
        addEdge({
          sourceVersion: src,
          targetVersion: input.outputVersion,
          pipelineRunId: run.id,
          derivationProgramId: input.derivationProgramId,
        });
      }

      emit({
        kind: 'run_recorded',
        versionId: input.outputVersion,
        at: completedAt,
        detail: run.id,
      });

      return run;
    },

    getVersion(versionId) {
      return versions.get(versionId);
    },

    getRun(runId) {
      return runs.get(runId);
    },

    upstream(versionId) {
      return (inbound.get(versionId) ?? []).map((e) => e.sourceVersion);
    },

    downstream(versionId) {
      return (outbound.get(versionId) ?? []).map((e) => e.targetVersion);
    },

    fullProvenance(versionId, maxDegree = 10_000) {
      return walk(versionId, (id) => store.upstream(id), maxDegree);
    },

    fullDescendants(versionId, maxDegree = 10_000) {
      return walk(versionId, (id) => store.downstream(id), maxDegree);
    },

    visualize(versionId, maxDegree = 10_000): ProvenanceGraph {
      const target = versions.get(versionId);
      if (!target) throw new Error(`versão desconhecida: ${versionId}`);

      const provenance = store.fullProvenance(versionId, maxDegree);
      const allIds = new Set<VersionId>([versionId, ...provenance]);

      const byDataset = new Map<string, CompoundLineageNode>();
      for (const id of allIds) {
        const v = versions.get(id);
        if (!v) continue;
        let compound = byDataset.get(v.datasetId);
        if (!compound) {
          compound = {
            datasetId: v.datasetId,
            datasetName: v.datasetName,
            isTarget: v.datasetId === target.datasetId,
            versions: [],
          };
          byDataset.set(v.datasetId, compound);
        }
        compound.versions.push(v);
      }

      const edges: LineageEdge[] = [];
      for (const id of allIds) {
        for (const e of inbound.get(id) ?? []) {
          if (allIds.has(e.sourceVersion)) edges.push(e);
        }
      }

      return {
        targetVersionId: versionId,
        nodes: [...byDataset.values()],
        edges,
        provenanceVersionIds: provenance,
      };
    },

    flagInvalid(versionId, reason) {
      const v = versions.get(versionId);
      if (!v) throw new Error(`versão desconhecida: ${versionId}`);
      v.invalid = true;
      v.invalidReason = reason;
      emit({
        kind: 'invalidated',
        versionId,
        at: clock(),
        detail: reason,
      });
    },

    propagateInvalid(versionId) {
      const root = versions.get(versionId);
      if (!root) throw new Error(`versão desconhecida: ${versionId}`);
      if (!root.invalid) {
        throw new Error(`propagateInvalid: ${versionId} não está marcada inválida`);
      }

      const affected: VersionId[] = [];
      for (const desc of store.fullDescendants(versionId)) {
        const node = versions.get(desc);
        if (!node) continue;
        if (!node.invalid) {
          node.invalid = true;
          node.invalidReason = `propagated from ${versionId}`;
          affected.push(desc);
          emit({
            kind: 'propagated_invalid',
            versionId: desc,
            at: clock(),
            detail: versionId,
          });
        }
      }
      return affected;
    },

    flagClassification(versionId, classification) {
      const v = versions.get(versionId);
      if (!v) throw new Error(`versão desconhecida: ${versionId}`);
      v.classification = resolveClassification(classification).name;
    },

    propagateClassification(versionId) {
      const root = versions.get(versionId);
      if (!root) throw new Error(`versão desconhecida: ${versionId}`);
      const sourceMark = resolveClassification(root.classification);

      const affected: VersionId[] = [];
      for (const desc of store.fullDescendants(versionId)) {
        const node = versions.get(desc);
        if (!node) continue;
        const current = resolveClassification(node.classification);
        if (sourceMark.rank <= current.rank) continue;
        node.classification = sourceMark.name;
        affected.push(desc);
        emit({
          kind: 'propagated_classification',
          versionId: desc,
          at: clock(),
          detail: `${versionId}:${sourceMark.name}`,
        });
      }
      return affected;
    },

    completeness(): LineageCompletenessReport {
      const derived = [...versions.values()].filter((v) => v.kind === 'DERIVED');
      const orphans: VersionId[] = [];
      let withInputs = 0;
      for (const v of derived) {
        const ups = store.upstream(v.versionId);
        if (ups.length === 0) orphans.push(v.versionId);
        else withInputs += 1;
      }
      return {
        complete: orphans.length === 0,
        totalDerived: derived.length,
        withInputs,
        orphanOutputVersions: orphans,
      };
    },

    listRuns() {
      return [...runs.values()];
    },

    listEdges() {
      const all: LineageEdge[] = [];
      for (const edges of inbound.values()) all.push(...edges);
      return all;
    },
  };

  return store;
}
