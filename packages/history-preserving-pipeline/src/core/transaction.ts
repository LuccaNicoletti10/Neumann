/**
 * history-preserving-pipeline — src/core/transaction.ts
 * start / write / commit — write após commit falha.
 */

import type { CommitInput, DatasetId, DatasetVersion, VersionId } from 'contracts';

import type { BlobStore } from './blob-store.js';
import { canonicalizeJson } from './hash.js';
import type { ManifestStore } from './manifest.js';
import type { Clock, IdGenerator, TransactionStatus } from './types.js';

export class TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionError';
  }
}

export interface TransactionRecord {
  id: string;
  datasetId: DatasetId;
  status: TransactionStatus;
  startedAt: string;
  committedAt?: string;
  parentVersion?: VersionId;
  inputVersions: VersionId[];
  transformationId?: string;
  schemaVersion: string;
  policyId: string | null;
  lineageRef: string | null;
  createdBy: string;
  /** Bytes pendentes (ainda não commitados). */
  pendingBytes?: Buffer;
  pendingMediaType?: string;
  pendingPayload?: unknown;
}

export interface StartTxOptions {
  parentVersion?: VersionId;
  inputVersions?: VersionId[];
  transformationId?: string;
  schemaVersion?: string;
  policyId?: string | null;
  lineageRef?: string | null;
  createdBy?: string;
}

export interface TransactionService {
  start(datasetId: DatasetId, opts?: StartTxOptions): TransactionRecord;
  write(txId: string, payload: unknown, mediaType?: string): void;
  commit(txId: string): DatasetVersion;
  get(txId: string): TransactionRecord | undefined;
}

export function createTransactionService(deps: {
  clock: Clock;
  nextId: IdGenerator;
  blobs: BlobStore;
  manifest: ManifestStore;
}): TransactionService {
  const txs = new Map<string, TransactionRecord>();

  return {
    start(datasetId: DatasetId, opts: StartTxOptions = {}): TransactionRecord {
      if (!deps.manifest.getDataset(datasetId)) {
        throw new TransactionError(`dataset inexistente: ${datasetId}`);
      }
      const latest = deps.manifest.getLatestVersion(datasetId);
      const parentVersion = opts.parentVersion ?? latest?.id;
      const id = deps.nextId('tx');
      const tx: TransactionRecord = {
        id,
        datasetId,
        status: 'OPEN',
        startedAt: deps.clock(),
        parentVersion,
        inputVersions: opts.inputVersions ? [...opts.inputVersions] : [],
        transformationId: opts.transformationId,
        schemaVersion: opts.schemaVersion ?? '1',
        policyId: opts.policyId ?? null,
        lineageRef: opts.lineageRef ?? null,
        createdBy: opts.createdBy ?? 'system',
      };
      txs.set(id, tx);
      return { ...tx, inputVersions: [...tx.inputVersions] };
    },

    write(txId: string, payload: unknown, mediaType?: string): void {
      const tx = txs.get(txId);
      if (!tx) throw new TransactionError(`transação inexistente: ${txId}`);
      if (tx.status !== 'OPEN') {
        throw new TransactionError(`write rejeitado: transação ${tx.status}`);
      }
      const bytes = Buffer.from(canonicalizeJson(payload), 'utf8');
      tx.pendingBytes = bytes;
      tx.pendingMediaType = mediaType ?? 'application/json';
      tx.pendingPayload = structuredClone(payload);
    },

    commit(txId: string): DatasetVersion {
      const tx = txs.get(txId);
      if (!tx) throw new TransactionError(`transação inexistente: ${txId}`);
      if (tx.status !== 'OPEN') {
        throw new TransactionError(`commit rejeitado: transação ${tx.status}`);
      }
      if (!tx.pendingBytes) {
        throw new TransactionError('commit rejeitado: nenhum write');
      }

      const container = deps.blobs.put(tx.pendingBytes, tx.pendingMediaType);
      const input: CommitInput = {
        parentVersion: tx.parentVersion,
        inputVersions: [...tx.inputVersions],
        transformationId: tx.transformationId,
        schemaVersion: tx.schemaVersion,
        contentRef: container.contentRef,
        contentHash: container.contentHash,
        policyId: tx.policyId,
        lineageRef: tx.lineageRef,
        createdBy: tx.createdBy,
        payload:
          tx.pendingPayload !== undefined &&
          (typeof tx.pendingPayload === 'object' || Array.isArray(tx.pendingPayload))
            ? (tx.pendingPayload as Record<string, unknown> | unknown[])
            : { value: tx.pendingPayload },
      };

      const version = deps.manifest.commitVersion(tx.datasetId, input);
      tx.status = 'COMMITTED';
      tx.committedAt = deps.clock();
      tx.pendingBytes = undefined;
      tx.pendingPayload = undefined;
      return version;
    },

    get(txId: string): TransactionRecord | undefined {
      const tx = txs.get(txId);
      if (!tx) return undefined;
      return {
        ...tx,
        inputVersions: [...tx.inputVersions],
        pendingBytes: tx.pendingBytes ? Buffer.from(tx.pendingBytes) : undefined,
        pendingPayload:
          tx.pendingPayload !== undefined ? structuredClone(tx.pendingPayload) : undefined,
      };
    },
  };
}
