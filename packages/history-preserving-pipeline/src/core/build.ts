/**
 * history-preserving-pipeline — src/core/build.ts
 * Derivation programs, DAG, build catalog, isOutOfDate, fila determinística.
 */

import type { DatasetVersion, VersionId } from 'contracts';

import type { BlobStore } from './blob-store.js';
import type { ManifestStore } from './manifest.js';
import type { TransactionService } from './transaction.js';
import type {
  BuildCatalogEntry,
  Clock,
  DerivationFn,
  DerivationProgram,
  IdGenerator,
} from './types.js';

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

export interface TraceNode {
  datasetId: string;
  versionId: VersionId;
  versionNumber: number;
  contentHash: string;
  transformationId?: string;
  inputVersions: VersionId[];
  children: TraceNode[];
}

export interface BuildService {
  registerProgram(program: Omit<DerivationProgram, 'id'> & { id?: string }, fn: DerivationFn): DerivationProgram;
  getProgram(programId: string): DerivationProgram | undefined;
  listPrograms(): DerivationProgram[];
  listCatalog(): BuildCatalogEntry[];
  isOutOfDate(programId: string): boolean;
  buildDataset(programId: string): DatasetVersion;
  /** Enfileira rebuild de programas que dependem de um dataset (após commit). */
  enqueueDependents(datasetId: string): void;
  /** Processa a fila síncrona (sem setInterval). */
  processQueue(): DatasetVersion[];
  getQueue(): string[];
  traceDatasetHistory(versionId: VersionId): TraceNode;
}

export function createBuildService(deps: {
  clock: Clock;
  nextId: IdGenerator;
  blobs: BlobStore;
  manifest: ManifestStore;
  transactions: TransactionService;
}): BuildService {
  const programs = new Map<string, DerivationProgram>();
  const fns = new Map<string, DerivationFn>();
  const catalog: BuildCatalogEntry[] = [];
  const lastBuildByProgram = new Map<string, BuildCatalogEntry>();
  /** programId → programs that list this program's output dataset as input */
  const dependents = new Map<string, Set<string>>();
  const queue: string[] = [];

  function wireDependents(program: DerivationProgram): void {
    for (const inputDs of program.inputDatasetIds) {
      // dependents keyed by dataset id for enqueueDependents
      let set = dependents.get(inputDs);
      if (!set) {
        set = new Set();
        dependents.set(inputDs, set);
      }
      set.add(program.id);
    }
  }

  function currentInputVersions(program: DerivationProgram): VersionId[] {
    const ids: VersionId[] = [];
    for (const dsId of program.inputDatasetIds) {
      const latest = deps.manifest.getLatestVersion(dsId);
      if (!latest) {
        throw new BuildError(`input sem versão: dataset ${dsId}`);
      }
      ids.push(latest.id);
    }
    return ids;
  }

  function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  const service: BuildService = {
    registerProgram(program, fn): DerivationProgram {
      const id = program.id ?? deps.nextId('prog');
      if (programs.has(id)) throw new BuildError(`programa já registrado: ${id}`);
      if (program.inputDatasetIds.length === 0) {
        throw new BuildError('programa precisa de ao menos um input');
      }
      if (!deps.manifest.getDataset(program.outputDatasetId)) {
        throw new BuildError(`output dataset inexistente: ${program.outputDatasetId}`);
      }
      for (const ds of program.inputDatasetIds) {
        if (!deps.manifest.getDataset(ds)) {
          throw new BuildError(`input dataset inexistente: ${ds}`);
        }
      }
      // ciclo simples: output não pode estar nos inputs
      if (program.inputDatasetIds.includes(program.outputDatasetId)) {
        throw new BuildError('ciclo: output não pode ser input do mesmo programa');
      }
      const full: DerivationProgram = {
        id,
        name: program.name,
        inputDatasetIds: [...program.inputDatasetIds],
        outputDatasetId: program.outputDatasetId,
        schemaVersion: program.schemaVersion,
      };
      programs.set(id, full);
      fns.set(id, fn);
      wireDependents(full);
      return { ...full, inputDatasetIds: [...full.inputDatasetIds] };
    },

    getProgram(programId: string): DerivationProgram | undefined {
      const p = programs.get(programId);
      return p ? { ...p, inputDatasetIds: [...p.inputDatasetIds] } : undefined;
    },

    listPrograms(): DerivationProgram[] {
      return [...programs.values()].map((p) => ({
        ...p,
        inputDatasetIds: [...p.inputDatasetIds],
      }));
    },

    listCatalog(): BuildCatalogEntry[] {
      return catalog.map((e) => ({
        ...e,
        inputVersionIds: [...e.inputVersionIds],
      }));
    },

    isOutOfDate(programId: string): boolean {
      const program = programs.get(programId);
      if (!program) throw new BuildError(`programa inexistente: ${programId}`);
      const last = lastBuildByProgram.get(programId);
      if (!last) return true;
      try {
        const current = currentInputVersions(program);
        return !arraysEqual(last.inputVersionIds, current);
      } catch {
        return true;
      }
    },

    buildDataset(programId: string): DatasetVersion {
      const program = programs.get(programId);
      if (!program) throw new BuildError(`programa inexistente: ${programId}`);
      const fn = fns.get(programId);
      if (!fn) throw new BuildError(`fn ausente: ${programId}`);

      const inputVersionIds = currentInputVersions(program);
      const inputPayloads = inputVersionIds.map((vid) => {
        const payload = deps.manifest.getPayload(vid);
        if (payload === undefined) {
          throw new BuildError(`payload ausente para versão ${vid}`);
        }
        return payload;
      });

      const outputPayload = fn(inputPayloads);
      const latestOut = deps.manifest.getLatestVersion(program.outputDatasetId);
      const tx = deps.transactions.start(program.outputDatasetId, {
        parentVersion: latestOut?.id,
        inputVersions: inputVersionIds,
        transformationId: program.id,
        schemaVersion: program.schemaVersion,
        createdBy: `build:${program.id}`,
      });
      deps.transactions.write(tx.id, outputPayload);
      const version = deps.transactions.commit(tx.id);

      const entry: BuildCatalogEntry = {
        id: deps.nextId('build'),
        programId,
        inputVersionIds: [...inputVersionIds],
        outputVersionId: version.id,
        contentHash: version.contentHash,
        builtAt: deps.clock(),
      };
      catalog.push(entry);
      lastBuildByProgram.set(programId, entry);

      // enfileira dependentes do output
      service.enqueueDependents(program.outputDatasetId);
      return version;
    },

    enqueueDependents(datasetId: string): void {
      const set = dependents.get(datasetId);
      if (!set) return;
      for (const programId of set) {
        if (!queue.includes(programId)) queue.push(programId);
      }
    },

    processQueue(): DatasetVersion[] {
      const built: DatasetVersion[] = [];
      while (queue.length > 0) {
        const programId = queue.shift()!;
        if (!service.isOutOfDate(programId)) continue;
        built.push(service.buildDataset(programId));
      }
      return built;
    },

    getQueue(): string[] {
      return [...queue];
    },

    traceDatasetHistory(versionId: VersionId): TraceNode {
      const visited = new Set<VersionId>();

      function walk(vid: VersionId): TraceNode {
        if (visited.has(vid)) {
          const v = deps.manifest.getVersion(vid);
          if (!v) throw new BuildError(`versão inexistente: ${vid}`);
          return {
            datasetId: v.datasetId,
            versionId: v.id,
            versionNumber: v.versionNumber,
            contentHash: v.contentHash,
            transformationId: v.transformationId,
            inputVersions: [...v.inputVersions],
            children: [],
          };
        }
        visited.add(vid);
        const v = deps.manifest.getVersion(vid);
        if (!v) throw new BuildError(`versão inexistente: ${vid}`);
        const children = v.inputVersions.map(walk);
        // também percorre parent se houver e não estiver já nos inputs
        if (v.parentVersion && !v.inputVersions.includes(v.parentVersion)) {
          children.push(walk(v.parentVersion));
        }
        return {
          datasetId: v.datasetId,
          versionId: v.id,
          versionNumber: v.versionNumber,
          contentHash: v.contentHash,
          transformationId: v.transformationId,
          inputVersions: [...v.inputVersions],
          children,
        };
      }

      return walk(versionId);
    },
  };

  return service;
}
