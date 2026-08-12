/**
 * transformation-runner — src/core/catalog.ts
 * Catálogo tabular em memória (origin datasets).
 */

import type { NamedTable, Row } from './types.js';

export interface TableCatalog {
  register(table: NamedTable): void;
  get(name: string): NamedTable | undefined;
  rows(name: string): Row[];
  list(): NamedTable[];
  /** Append-only rows (para incremental CONCATENATE). */
  append(name: string, rows: readonly Row[]): void;
}

export function createTableCatalog(): TableCatalog {
  const tables = new Map<string, NamedTable>();

  return {
    register(table) {
      tables.set(table.name, {
        name: table.name,
        columns: [...table.columns],
        rows: table.rows.map((r) => ({ ...r })),
      });
    },
    get(name) {
      return tables.get(name);
    },
    rows(name) {
      const t = tables.get(name);
      if (!t) throw new Error(`tabela inexistente: ${name}`);
      return t.rows.map((r) => ({ ...r }));
    },
    list() {
      return [...tables.values()].map((t) => ({
        name: t.name,
        columns: [...t.columns],
        rows: t.rows.map((r) => ({ ...r })),
      }));
    },
    append(name, rows) {
      const t = tables.get(name);
      if (!t) throw new Error(`tabela inexistente: ${name}`);
      for (const r of rows) t.rows.push({ ...r });
    },
  };
}
