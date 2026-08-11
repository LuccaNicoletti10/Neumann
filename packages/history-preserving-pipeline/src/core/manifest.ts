/**
 * history-preserving-pipeline — src/core/manifest.ts
 * Datasets + versões COMMITTED imutáveis.
 */

import type {
  CommitInput,
  Dataset,
  DatasetDef,
  DatasetId,
  DatasetVersion,
  VersionId,
} from 'contracts';

import type { Clock, IdGenerator } from './types.js';

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

export interface ManifestStore {
  createDataset(def: DatasetDef): Dataset;
  getDataset(id: DatasetId): Dataset | undefined;
  listDatasets(): Dataset[];
  /** Insere versão COMMITTED. Duplicate contentHash no mesmo dataset → retorna existente. */
  commitVersion(datasetId: DatasetId, input: CommitInput): DatasetVersion;
  getVersion(versionId: VersionId): DatasetVersion | undefined;
  getLatestVersion(datasetId: DatasetId): DatasetVersion | undefined;
  listVersions(datasetId: DatasetId): DatasetVersion[];
  findByContentHash(datasetId: DatasetId, contentHash: string): DatasetVersion | undefined;
  /** Gates: mutação de versão COMMITTED sempre falha. */
  updateVersion(_versionId: VersionId, _patch: Partial<DatasetVersion>): never;
  deleteVersion(_versionId: VersionId): never;
  /** Payload lógico associado à versão (para diff/trace). */
  getPayload(versionId: VersionId): unknown | undefined;
}

export function createManifestStore(deps: { clock: Clock; nextId: IdGenerator }): ManifestStore {
  const datasets = new Map<DatasetId, Dataset>();
  const versions = new Map<VersionId, DatasetVersion>();
  const byDataset = new Map<DatasetId, VersionId[]>();
  const payloads = new Map<VersionId, unknown>();
  const hashIndex = new Map<string, VersionId>(); // `${datasetId}:${contentHash}`

  function hashKey(datasetId: DatasetId, contentHash: string): string {
    return `${datasetId}:${contentHash}`;
  }

  return {
    createDataset(def: DatasetDef): Dataset {
      if (!def.name || def.name.trim().length === 0) {
        throw new ManifestError('nome do dataset obrigatório');
      }
      const id = deps.nextId('ds');
      const dataset: Dataset = {
        id,
        name: def.name,
        description: def.description,
        createdAt: deps.clock(),
      };
      datasets.set(id, dataset);
      byDataset.set(id, []);
      return { ...dataset };
    },

    getDataset(id: DatasetId): Dataset | undefined {
      const d = datasets.get(id);
      return d ? { ...d } : undefined;
    },

    listDatasets(): Dataset[] {
      return [...datasets.values()].map((d) => ({ ...d }));
    },

    commitVersion(datasetId: DatasetId, input: CommitInput): DatasetVersion {
      const dataset = datasets.get(datasetId);
      if (!dataset) throw new ManifestError(`dataset inexistente: ${datasetId}`);

      const existingId = hashIndex.get(hashKey(datasetId, input.contentHash));
      if (existingId !== undefined) {
        const existing = versions.get(existingId);
        if (!existing) throw new ManifestError(`índice inconsistente: ${existingId}`);
        return { ...existing, inputVersions: [...existing.inputVersions] };
      }

      if (input.parentVersion !== undefined) {
        const parent = versions.get(input.parentVersion);
        if (!parent) throw new ManifestError(`parentVersion inexistente: ${input.parentVersion}`);
        if (parent.datasetId !== datasetId) {
          throw new ManifestError('parentVersion deve pertencer ao mesmo dataset');
        }
      }

      for (const iv of input.inputVersions) {
        if (!versions.has(iv)) {
          throw new ManifestError(`inputVersion inexistente: ${iv}`);
        }
      }

      const list = byDataset.get(datasetId) ?? [];
      const versionNumber = list.length + 1;
      const id = deps.nextId('ver');
      const version: DatasetVersion = {
        id,
        datasetId,
        versionNumber,
        parentVersion: input.parentVersion,
        inputVersions: [...input.inputVersions],
        transformationId: input.transformationId,
        schemaVersion: input.schemaVersion,
        contentRef: input.contentRef,
        contentHash: input.contentHash,
        policyId: input.policyId,
        lineageRef: input.lineageRef,
        createdAt: deps.clock(),
        createdBy: input.createdBy ?? 'system',
        status: 'COMMITTED',
      };

      versions.set(id, version);
      list.push(id);
      byDataset.set(datasetId, list);
      hashIndex.set(hashKey(datasetId, input.contentHash), id);
      if (input.payload !== undefined) {
        payloads.set(id, structuredClone(input.payload));
      }

      dataset.latestVersionId = id;
      return { ...version, inputVersions: [...version.inputVersions] };
    },

    getVersion(versionId: VersionId): DatasetVersion | undefined {
      const v = versions.get(versionId);
      return v ? { ...v, inputVersions: [...v.inputVersions] } : undefined;
    },

    getLatestVersion(datasetId: DatasetId): DatasetVersion | undefined {
      const dataset = datasets.get(datasetId);
      if (!dataset?.latestVersionId) return undefined;
      return this.getVersion(dataset.latestVersionId);
    },

    listVersions(datasetId: DatasetId): DatasetVersion[] {
      const ids = byDataset.get(datasetId) ?? [];
      return ids.map((id) => {
        const v = versions.get(id)!;
        return { ...v, inputVersions: [...v.inputVersions] };
      });
    },

    findByContentHash(datasetId: DatasetId, contentHash: string): DatasetVersion | undefined {
      const id = hashIndex.get(hashKey(datasetId, contentHash));
      if (id === undefined) return undefined;
      return this.getVersion(id);
    },

    updateVersion(_versionId: VersionId, _patch: Partial<DatasetVersion>): never {
      throw new ManifestError('versão COMMITTED é imutável: update rejeitado');
    },

    deleteVersion(_versionId: VersionId): never {
      throw new ManifestError('versão COMMITTED é imutável: delete rejeitado');
    },

    getPayload(versionId: VersionId): unknown | undefined {
      if (!payloads.has(versionId)) return undefined;
      return structuredClone(payloads.get(versionId));
    },
  };
}
