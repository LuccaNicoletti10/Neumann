/**
 * history-preserving-pipeline — src/core/lake.ts
 * DatasetStore tipado contra contracts (fachada sobre manifest + compare).
 */

import type {
  CommitInput,
  Dataset,
  DatasetDef,
  DatasetId,
  DatasetStore,
  DatasetVersion,
  VersionDiff,
  VersionId,
} from 'contracts';
import { assertCommitInput } from 'contracts';

import { compareVersions } from './compare.js';
import type { ManifestStore } from './manifest.js';

export function createDatasetStoreAdapter(manifest: ManifestStore): DatasetStore {
  return {
    createDataset(def: DatasetDef): Dataset {
      return manifest.createDataset(def);
    },
    commitVersion(datasetId: DatasetId, input: CommitInput): DatasetVersion {
      assertCommitInput(input);
      return manifest.commitVersion(datasetId, input);
    },
    getLatestVersion(datasetId: DatasetId): DatasetVersion | undefined {
      return manifest.getLatestVersion(datasetId);
    },
    getVersion(versionId: VersionId): DatasetVersion | undefined {
      return manifest.getVersion(versionId);
    },
    listVersions(datasetId: DatasetId): DatasetVersion[] {
      return manifest.listVersions(datasetId);
    },
    diff(a: VersionId, b: VersionId): VersionDiff {
      return compareVersions(manifest, a, b);
    },
  };
}
