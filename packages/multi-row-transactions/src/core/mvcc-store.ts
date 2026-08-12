/**
 * multi-row-transactions — src/core/mvcc-store.ts
 * Células versionadas por write timestamp.
 */

import type { LogicalTimestamp } from 'contracts';

import type { CellVersion } from './types.js';

export interface MvccStore {
  createTable(name: string): void;
  hasTable(name: string): boolean;
  listTables(): string[];
  write(
    table: string,
    rowKey: string,
    column: string,
    writeTs: LogicalTimestamp,
    value: unknown,
  ): void;
  /** Valor com writeTs <= asOf (bruto, sem filtrar commit). */
  readRaw(
    table: string,
    rowKey: string,
    column: string,
    asOf: LogicalTimestamp,
  ): { writeTs: LogicalTimestamp; value: unknown } | undefined;
  latestWriteTs(
    table: string,
    rowKey: string,
    column: string,
  ): LogicalTimestamp | undefined;
  listRowKeys(table: string): string[];
  listColumns(table: string, rowKey: string): string[];
  /** Todas as versões de uma célula (para replay/diff). */
  listVersions(table: string, rowKey: string, column: string): CellVersion[];
  /** Remove versões de um writeTs (rollback pós-crash simulado). */
  removeWriteTs(table: string, rowKey: string, column: string, writeTs: LogicalTimestamp): void;
}

type Cell = Map<LogicalTimestamp, unknown>; // writeTs → value
type Row = Map<string, Cell>; // column → cell
type Table = Map<string, Row>; // rowKey → row

export function createMvccStore(): MvccStore {
  const tables = new Map<string, Table>();

  function requireTable(name: string): Table {
    const t = tables.get(name);
    if (!t) throw new Error(`tabela inexistente: ${name}`);
    return t;
  }

  return {
    createTable(name: string): void {
      if (!tables.has(name)) tables.set(name, new Map());
    },

    hasTable(name: string): boolean {
      return tables.has(name);
    },

    listTables(): string[] {
      return [...tables.keys()].sort();
    },

    write(table, rowKey, column, writeTs, value): void {
      const t = requireTable(table);
      let row = t.get(rowKey);
      if (!row) {
        row = new Map();
        t.set(rowKey, row);
      }
      let cell = row.get(column);
      if (!cell) {
        cell = new Map();
        row.set(column, cell);
      }
      cell.set(writeTs, structuredClone(value));
    },

    readRaw(table, rowKey, column, asOf) {
      const t = tables.get(table);
      if (!t) return undefined;
      const cell = t.get(rowKey)?.get(column);
      if (!cell) return undefined;
      let best: LogicalTimestamp | undefined;
      for (const ts of cell.keys()) {
        if (ts <= asOf && (best === undefined || ts > best)) best = ts;
      }
      if (best === undefined) return undefined;
      return { writeTs: best, value: structuredClone(cell.get(best)) };
    },

    latestWriteTs(table, rowKey, column) {
      const cell = tables.get(table)?.get(rowKey)?.get(column);
      if (!cell || cell.size === 0) return undefined;
      return Math.max(...cell.keys());
    },

    listRowKeys(table) {
      const t = tables.get(table);
      if (!t) return [];
      return [...t.keys()].sort();
    },

    listColumns(table, rowKey) {
      const row = tables.get(table)?.get(rowKey);
      if (!row) return [];
      return [...row.keys()].sort();
    },

    listVersions(table, rowKey, column) {
      const cell = tables.get(table)?.get(rowKey)?.get(column);
      if (!cell) return [];
      return [...cell.entries()]
        .map(([writeTs, value]) => ({ writeTs, value: structuredClone(value) }))
        .sort((a, b) => a.writeTs - b.writeTs);
    },

    removeWriteTs(table, rowKey, column, writeTs) {
      tables.get(table)?.get(rowKey)?.get(column)?.delete(writeTs);
    },
  };
}
