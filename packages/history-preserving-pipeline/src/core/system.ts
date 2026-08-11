/**
 * history-preserving-pipeline — src/core/system.ts
 * Fachada pública HistoryPreservingPipeline (DataLake + build + txs).
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

import { type BlobStore, MemoryBlobStore } from './blob-store.js';
import { type BuildService, createBuildService, type TraceNode } from './build.js';
import { compareVersions } from './compare.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { createDatasetStoreAdapter } from './lake.js';
import { createManifestStore, type ManifestStore } from './manifest.js';
import {
  createTransactionService,
  type StartTxOptions,
  type TransactionRecord,
  type TransactionService,
} from './transaction.js';
import type { Clock, DerivationFn, DerivationProgram, IdGenerator, PipelineDeps } from './types.js';

export interface HistoryPreservingPipeline {
  readonly blobs: BlobStore;
  readonly manifest: ManifestStore;
  readonly transactions: TransactionService;
  readonly build: BuildService;
  readonly store: DatasetStore;

  createDataset(def: DatasetDef): Dataset;
  commitVersion(datasetId: DatasetId, input: CommitInput): DatasetVersion;
  getLatestVersion(datasetId: DatasetId): DatasetVersion | undefined;
  getVersion(versionId: VersionId): DatasetVersion | undefined;
  listVersions(datasetId: DatasetId): DatasetVersion[];
  diff(a: VersionId, b: VersionId): VersionDiff;
  compareVersions(a: VersionId, b: VersionId): VersionDiff;

  startTransaction(datasetId: DatasetId, opts?: StartTxOptions): TransactionRecord;
  writeTransaction(txId: string, payload: unknown, mediaType?: string): void;
  commitTransaction(txId: string): DatasetVersion;

  registerProgram(
    program: Omit<DerivationProgram, 'id'> & { id?: string },
    fn: DerivationFn,
  ): DerivationProgram;
  buildDataset(programId: string): DatasetVersion;
  isOutOfDate(programId: string): boolean;
  processQueue(): DatasetVersion[];
  traceDatasetHistory(versionId: VersionId): TraceNode;
}

export interface CreatePipelineOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  blobs?: BlobStore;
}

export function createHistoryPreservingPipeline(
  opts: CreatePipelineOptions = {},
): HistoryPreservingPipeline {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const blobs = opts.blobs ?? new MemoryBlobStore();
  const manifest = createManifestStore({ clock, nextId });
  const transactions = createTransactionService({ clock, nextId, blobs, manifest });
  const build = createBuildService({ clock, nextId, blobs, manifest, transactions });
  const store = createDatasetStoreAdapter(manifest);

  return {
    blobs,
    manifest,
    transactions,
    build,
    store,

    createDataset: (def) => manifest.createDataset(def),
    commitVersion: (datasetId, input) => {
      assertCommitInput(input);
      return manifest.commitVersion(datasetId, input);
    },
    getLatestVersion: (datasetId) => manifest.getLatestVersion(datasetId),
    getVersion: (versionId) => manifest.getVersion(versionId),
    listVersions: (datasetId) => manifest.listVersions(datasetId),
    diff: (a, b) => compareVersions(manifest, a, b),
    compareVersions: (a, b) => compareVersions(manifest, a, b),

    startTransaction: (datasetId, startOpts) => transactions.start(datasetId, startOpts),
    writeTransaction: (txId, payload, mediaType) => transactions.write(txId, payload, mediaType),
    commitTransaction: (txId) => transactions.commit(txId),

    registerProgram: (program, fn) => build.registerProgram(program, fn),
    buildDataset: (programId) => build.buildDataset(programId),
    isOutOfDate: (programId) => build.isOutOfDate(programId),
    processQueue: () => build.processQueue(),
    traceDatasetHistory: (versionId) => build.traceDatasetHistory(versionId),
  };
}

/** Alias alinhado à patente (DataLake). */
export const createDataLake = createHistoryPreservingPipeline;

export type { PipelineDeps, TraceNode };
