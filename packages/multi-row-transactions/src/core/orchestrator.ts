/**
 * multi-row-transactions — src/core/orchestrator.ts
 * START/GET/SET/COMMIT + snapshot isolation + W/W conflict (US 8504542 / 9619507).
 */

import type { LogicalTimestamp } from 'contracts';

import type { LockService } from './lease-lock.js';
import type { MvccStore } from './mvcc-store.js';
import type { TimestampService } from './timestamp.js';
import type { TransactionTable } from './transaction-table.js';
import type { IdGenerator, Transaction, WriteOp } from './types.js';

export class TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionError';
  }
}

function rowLockId(table: string, rowKey: string): string {
  return `${table}:${rowKey}`;
}

function txTableLockId(startTs: LogicalTimestamp): string {
  return `transaction_table:${startTs}`;
}

export interface Orchestrator {
  start(): Transaction;
  get(tx: Transaction, table: string, rowKey: string, column: string): unknown;
  set(tx: Transaction, table: string, rowKey: string, column: string, value: unknown): void;
  commit(tx: Transaction): boolean;
  abort(tx: Transaction): void;
  /** Simula crash após writes no store mas antes de putIfAbsent — limpa writes orfãos. */
  crashBeforeCommitFinalize(tx: Transaction): void;
  getTransaction(id: string): Transaction | undefined;
  listActive(): Transaction[];
}

export function createOrchestrator(deps: {
  store: MvccStore;
  locks: LockService;
  timestamps: TimestampService;
  txTable: TransactionTable;
  nextId: IdGenerator;
}): Orchestrator {
  const active = new Map<string, Transaction>();

  function requireActive(tx: Transaction): void {
    if (tx.status !== 'ACTIVE') {
      throw new TransactionError(`transação não ACTIVE: ${tx.status}`);
    }
  }

  function releaseLocks(tx: Transaction): void {
    for (const lock of tx.locks) {
      deps.locks.release(lock.lockId, tx.id);
    }
    tx.locks = [];
  }

  /**
   * Snapshot isolation (FIGURA 10): lê versão commitada com commitTs <= startTs.
   * Versões de txs ainda não commitadas → tenta fail explícito ou pula.
   */
  function readSnapshot(
    tx: Transaction,
    table: string,
    rowKey: string,
    column: string,
  ): unknown {
    let asOf = tx.startTs;
    // também considera writes buffered da própria tx
    for (let i = tx.bufferedWrites.length - 1; i >= 0; i--) {
      const w = tx.bufferedWrites[i]!;
      if (w.table === table && w.rowKey === rowKey && w.column === column) {
        return structuredClone(w.value);
      }
    }

    while (asOf >= 0) {
      const raw = deps.store.readRaw(table, rowKey, column, asOf);
      if (!raw) return undefined;

      const writeTs = raw.writeTs;
      const lockId = txTableLockId(writeTs);
      const gotLock = deps.locks.acquire(lockId, tx.id, 'READ');
      if (!gotLock) {
        // Writer ainda segura WRITE no commit — versão não visível; tenta anterior.
        asOf = writeTs - 1;
        continue;
      }
      let commitTs = deps.txTable.getCommitTs(writeTs);
      deps.locks.release(lockId, tx.id);

      if (commitTs === undefined) {
        // writer ainda ACTIVE e sem lock exclusivo — tenta falhar explicitamente
        const failed = deps.txTable.explicitlyFail(writeTs);
        if (failed) {
          asOf = writeTs - 1;
          continue;
        }
        commitTs = deps.txTable.getCommitTs(writeTs);
        if (commitTs === undefined || commitTs === -1) {
          asOf = writeTs - 1;
          continue;
        }
      }

      if (commitTs === -1) {
        asOf = writeTs - 1;
        continue;
      }

      if (commitTs <= tx.startTs) {
        return raw.value;
      }

      asOf = writeTs - 1;
    }
    return undefined;
  }

  function acquireCommitLocks(tx: Transaction): boolean {
    const txLock = txTableLockId(tx.startTs);
    if (!deps.locks.acquire(txLock, tx.id, 'WRITE')) return false;
    tx.locks.push({ lockId: txLock, lockType: 'WRITE' });

    const rowIds = [
      ...new Set(tx.bufferedWrites.map((w) => rowLockId(w.table, w.rowKey))),
    ].sort();

    for (const rid of rowIds) {
      if (!deps.locks.acquire(rid, tx.id, 'WRITE')) {
        releaseLocks(tx);
        return false;
      }
      tx.locks.push({ lockId: rid, lockType: 'WRITE' });
    }
    return true;
  }

  function detectWriteWriteConflicts(tx: Transaction): boolean {
    for (const op of tx.bufferedWrites) {
      const latest = deps.store.latestWriteTs(op.table, op.rowKey, op.column);
      if (latest === undefined) continue;

      let commitTs = deps.txTable.getCommitTs(latest);
      if (commitTs === undefined) {
        const failed = deps.txTable.explicitlyFail(latest);
        if (!failed) {
          commitTs = deps.txTable.getCommitTs(latest);
          if (commitTs !== undefined && commitTs !== -1 && commitTs > tx.startTs) {
            return true;
          }
        }
        continue;
      }
      if (commitTs === -1) continue;
      if (commitTs > tx.startTs) return true;
    }
    return false;
  }

  function writeBuffered(tx: Transaction): void {
    for (const op of tx.bufferedWrites) {
      deps.store.write(op.table, op.rowKey, op.column, tx.startTs, op.value);
    }
  }

  function validateLocks(tx: Transaction): boolean {
    for (const lock of tx.locks) {
      if (!deps.locks.validate(lock.lockId, tx.id)) return false;
    }
    return true;
  }

  function rollbackStoreWrites(tx: Transaction): void {
    for (const op of tx.bufferedWrites) {
      deps.store.removeWriteTs(op.table, op.rowKey, op.column, tx.startTs);
    }
  }

  return {
    start(): Transaction {
      const startTs = deps.timestamps.next();
      const tx: Transaction = {
        id: deps.nextId('tx'),
        startTs,
        status: 'ACTIVE',
        bufferedWrites: [],
        locks: [],
      };
      active.set(tx.id, tx);
      return tx;
    },

    get(tx, table, rowKey, column) {
      requireActive(tx);
      return readSnapshot(tx, table, rowKey, column);
    },

    set(tx, table, rowKey, column, value) {
      requireActive(tx);
      if (!deps.store.hasTable(table)) {
        throw new TransactionError(`tabela inexistente: ${table}`);
      }
      const op: WriteOp = {
        table,
        rowKey,
        column,
        value: structuredClone(value),
      };
      tx.bufferedWrites.push(op);
    },

    commit(tx): boolean {
      requireActive(tx);
      try {
        if (!acquireCommitLocks(tx)) {
          tx.status = 'FAILED';
          return false;
        }
        if (detectWriteWriteConflicts(tx)) {
          releaseLocks(tx);
          tx.status = 'FAILED';
          return false;
        }

        writeBuffered(tx);

        if (!validateLocks(tx)) {
          rollbackStoreWrites(tx);
          releaseLocks(tx);
          tx.status = 'FAILED';
          return false;
        }

        const commitTs = deps.timestamps.next();
        const ok = deps.txTable.putIfAbsent(tx.startTs, commitTs);
        if (!ok) {
          rollbackStoreWrites(tx);
          releaseLocks(tx);
          tx.status = 'FAILED';
          return false;
        }

        tx.commitTs = commitTs;
        releaseLocks(tx);
        tx.status = 'COMMITTED';
        return true;
      } catch {
        rollbackStoreWrites(tx);
        releaseLocks(tx);
        tx.status = 'FAILED';
        return false;
      }
    },

    abort(tx): void {
      if (tx.status !== 'ACTIVE') return;
      releaseLocks(tx);
      tx.bufferedWrites = [];
      tx.status = 'ABORTED';
    },

    crashBeforeCommitFinalize(tx): void {
      requireActive(tx);
      // simula: writes já no store (fase 1) mas putIfAbsent não ocorreu
      if (!acquireCommitLocks(tx)) {
        tx.status = 'FAILED';
        return;
      }
      writeBuffered(tx);
      // crash: não chama putIfAbsent; marca failed e limpa writes órfãos
      deps.txTable.explicitlyFail(tx.startTs);
      rollbackStoreWrites(tx);
      releaseLocks(tx);
      tx.status = 'FAILED';
    },

    getTransaction(id) {
      return active.get(id);
    },

    listActive() {
      return [...active.values()].filter((t) => t.status === 'ACTIVE');
    },
  };
}
