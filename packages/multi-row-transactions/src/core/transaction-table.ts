/**
 * multi-row-transactions — src/core/transaction-table.ts
 * startTs → commitTs (US 8,504,542 / 9,619,507).
 */

import type { LogicalTimestamp } from 'contracts';

export interface TransactionTable {
  putIfAbsent(startTs: LogicalTimestamp, commitTs: LogicalTimestamp): boolean;
  explicitlyFail(startTs: LogicalTimestamp): boolean;
  getCommitTs(startTs: LogicalTimestamp): LogicalTimestamp | undefined | -1;
  isCommitted(startTs: LogicalTimestamp): boolean;
  isFailed(startTs: LogicalTimestamp): boolean;
  entries(): Array<{ startTs: LogicalTimestamp; commitTs: LogicalTimestamp }>;
  failed(): LogicalTimestamp[];
}

export function createTransactionTable(): TransactionTable {
  const committed = new Map<LogicalTimestamp, LogicalTimestamp>();
  const failed = new Set<LogicalTimestamp>();

  return {
    putIfAbsent(startTs, commitTs): boolean {
      if (committed.has(startTs) || failed.has(startTs)) return false;
      committed.set(startTs, commitTs);
      return true;
    },

    explicitlyFail(startTs): boolean {
      if (committed.has(startTs) || failed.has(startTs)) return false;
      failed.add(startTs);
      return true;
    },

    getCommitTs(startTs) {
      if (failed.has(startTs)) return -1;
      return committed.get(startTs);
    },

    isCommitted(startTs): boolean {
      return committed.has(startTs);
    },

    isFailed(startTs): boolean {
      return failed.has(startTs);
    },

    entries() {
      return [...committed.entries()]
        .map(([startTs, commitTs]) => ({ startTs, commitTs }))
        .sort((a, b) => a.startTs - b.startTs);
    },

    failed() {
      return [...failed].sort((a, b) => a - b);
    },
  };
}
