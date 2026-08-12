/**
 * multi-row-transactions — src/core/types.ts
 */

import type { LogicalTimestamp, TxStatus } from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;
export type LockType = 'READ' | 'WRITE';

export interface LeaseRecord {
  lesseeId: string;
  lockId: string;
  lockType: LockType;
  /** Instantes ISO (clock injetável). */
  startAt: string;
  endAt: string;
}

export interface WriteOp {
  table: string;
  rowKey: string;
  column: string;
  value: unknown;
}

export interface LockInfo {
  lockId: string;
  lockType: LockType;
}

export interface Transaction {
  id: string;
  startTs: LogicalTimestamp;
  commitTs?: LogicalTimestamp;
  status: TxStatus;
  bufferedWrites: WriteOp[];
  locks: LockInfo[];
}

export interface CellVersion {
  writeTs: LogicalTimestamp;
  value: unknown;
}
