/**
 * multi-row-transactions — src/core/system.ts
 * Fachada: MultiRowTransactionSystem + TimeTravelStore.
 */

import type {
  LogicalTimestamp,
  ReplayResult,
  SnapshotRequest,
  SnapshotResult,
  TimeTravelStore,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { hashCanonical } from './hash.js';
import { createLockService, type LockService } from './lease-lock.js';
import { createMvccStore, type MvccStore } from './mvcc-store.js';
import { createOrchestrator, type Orchestrator } from './orchestrator.js';
import { createTimestampService, type TimestampService } from './timestamp.js';
import { createTransactionTable, type TransactionTable } from './transaction-table.js';
import type { Clock, IdGenerator, Transaction } from './types.js';

export interface MultiRowTransactionSystem extends TimeTravelStore {
  readonly store: MvccStore;
  readonly locks: LockService;
  readonly timestamps: TimestampService;
  readonly txTable: TransactionTable;
  readonly orchestrator: Orchestrator;

  createTable(name: string): void;
  startTransaction(): Transaction;
  get(tx: Transaction, table: string, rowKey: string, column: string): unknown;
  set(tx: Transaction, table: string, rowKey: string, column: string, value: unknown): void;
  commit(tx: Transaction): boolean;
  abort(tx: Transaction): void;
  crashBeforeCommitFinalize(tx: Transaction): void;

  /** Indexa ISO wall-clock (clock ticks) → logical ts no momento do commit. */
  noteWallClock(iso: string, logicalTs: LogicalTimestamp): void;
}

export interface CreateSystemOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  tables?: string[];
  leaseMs?: number;
}

export function createMultiRowTransactionSystem(
  opts: CreateSystemOptions = {},
): MultiRowTransactionSystem {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const store = createMvccStore();
  const locks = createLockService({ clock, leaseMs: opts.leaseMs });
  const timestamps = createTimestampService();
  const txTable = createTransactionTable();
  const orchestrator = createOrchestrator({
    store,
    locks,
    timestamps,
    txTable,
    nextId,
  });

  /** ISO → logical commit ts (para snapshot(at: ISO)). */
  const wallIndex: Array<{ iso: string; logicalTs: LogicalTimestamp }> = [];

  for (const t of opts.tables ?? ['accounts', 'users']) {
    store.createTable(t);
  }

  function resolveLogicalAt(at: string | LogicalTimestamp): LogicalTimestamp {
    if (typeof at === 'number') return at;
    // maior commitTs cujo wall iso <= at
    const target = Date.parse(at);
    if (!Number.isFinite(target)) throw new Error(`timestamp ISO inválido: ${at}`);
    let best: LogicalTimestamp = 0;
    for (const entry of wallIndex) {
      if (Date.parse(entry.iso) <= target && entry.logicalTs > best) {
        best = entry.logicalTs;
      }
    }
    // se ninguém commitou ainda, usa 0 (só BASE vazia)
    // também: se at é futuro, usa current
    if (best === 0 && wallIndex.length === 0) {
      return timestamps.current();
    }
    return best;
  }

  function materializeVisible(
    dataset: string,
    asOfCommitTs: LogicalTimestamp,
  ): Record<string, Record<string, unknown>> {
    const rows: Record<string, Record<string, unknown>> = {};
    for (const rowKey of store.listRowKeys(dataset)) {
      const cols: Record<string, unknown> = {};
      for (const column of store.listColumns(dataset, rowKey)) {
        // encontra versão visível: writeTs com commitTs <= asOfCommitTs
        const versions = store.listVersions(dataset, rowKey, column);
        let chosen: unknown = undefined;
        let chosenCommit = -1;
        for (const v of versions) {
          const c = txTable.getCommitTs(v.writeTs);
          if (c === undefined || c === -1) continue;
          if (c <= asOfCommitTs && c >= chosenCommit) {
            chosen = v.value;
            chosenCommit = c;
          }
        }
        if (chosenCommit >= 0) {
          cols[column] = chosen;
        }
      }
      if (Object.keys(cols).length > 0) rows[rowKey] = cols;
    }
    return rows;
  }

  function commitAndIndex(tx: Transaction): boolean {
    const wall = clock();
    const ok = orchestrator.commit(tx);
    if (ok && tx.commitTs !== undefined) {
      wallIndex.push({ iso: wall, logicalTs: tx.commitTs });
    }
    return ok;
  }

  const system: MultiRowTransactionSystem = {
    store,
    locks,
    timestamps,
    txTable,
    orchestrator,

    createTable(name) {
      store.createTable(name);
    },

    startTransaction() {
      return orchestrator.start();
    },

    get(tx, table, rowKey, column) {
      return orchestrator.get(tx, table, rowKey, column);
    },

    set(tx, table, rowKey, column, value) {
      orchestrator.set(tx, table, rowKey, column, value);
    },

    commit(tx) {
      return commitAndIndex(tx);
    },

    abort(tx) {
      orchestrator.abort(tx);
    },

    crashBeforeCommitFinalize(tx) {
      orchestrator.crashBeforeCommitFinalize(tx);
    },

    noteWallClock(iso, logicalTs) {
      wallIndex.push({ iso, logicalTs });
    },

    snapshot(req: SnapshotRequest): SnapshotResult {
      const logicalTimestamp = resolveLogicalAt(req.at);
      const rows = materializeVisible(req.dataset, logicalTimestamp);
      return {
        dataset: req.dataset,
        at: req.at,
        logicalTimestamp,
        rows,
        contentHash: hashCanonical(rows),
      };
    },

    replay(dataset: string, throughTimestamp?: LogicalTimestamp): ReplayResult {
      const through = throughTimestamp ?? timestamps.current();
      const entries = txTable.entries().filter((e) => e.commitTs <= through);
      const rows = materializeVisible(dataset, through);
      return {
        dataset,
        throughTimestamp: through,
        rows,
        contentHash: hashCanonical(rows),
        transactionsReplayed: entries.length,
      };
    },

    diffVersions(dataset, a, b) {
      const ra = materializeVisible(dataset, a);
      const rb = materializeVisible(dataset, b);
      const keysA = new Set(Object.keys(ra));
      const keysB = new Set(Object.keys(rb));
      const addedRows = [...keysB].filter((k) => !keysA.has(k)).sort();
      const removedRows = [...keysA].filter((k) => !keysB.has(k)).sort();
      const changedCells: Array<{ row: string; column: string }> = [];
      for (const row of keysA) {
        if (!keysB.has(row)) continue;
        const ca = ra[row]!;
        const cb = rb[row]!;
        const cols = new Set([...Object.keys(ca), ...Object.keys(cb)]);
        for (const col of cols) {
          if (hashCanonical(ca[col]) !== hashCanonical(cb[col])) {
            changedCells.push({ row, column: col });
          }
        }
      }
      changedCells.sort((x, y) =>
        x.row === y.row ? x.column.localeCompare(y.column) : x.row.localeCompare(y.row),
      );
      return { a, b, addedRows, removedRows, changedCells };
    },
  };

  return system;
}
