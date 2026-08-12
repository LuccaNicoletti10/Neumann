/**
 * transformation-runner — src/core/executor.ts
 * Executor determinístico em memória (+ interface DuckDB-ready).
 */

import type { TransformProgram, TransformRunResult, TransformStep } from 'contracts';

import { getOp } from './ops.js';
import { hashRows } from './hash.js';
import type { Row } from './types.js';
import type { TableCatalog } from './catalog.js';

export interface TransformExecutor {
  readonly engine: 'memory' | 'duckdb';
  execute(program: TransformProgram, extras?: ExecuteOptions): TransformRunResult;
}

export interface ExecuteOptions {
  /**
   * Se definido, usa estas rows como source em vez do catálogo
   * (útil para delta incremental).
   */
  sourceRowsOverride?: Row[];
  /** Tabela auxiliar name→rows (override parcial). */
  tableOverrides?: Map<string, Row[]>;
  mode?: TransformRunResult['mode'];
}

export function createMemoryExecutor(catalog: TableCatalog): TransformExecutor {
  return {
    engine: 'memory',
    execute(program, extras = {}) {
      const steps = program.steps.map((s) => ({ ...s, params: { ...s.params } }));
      const tables = new Map<string, Row[]>();
      for (const t of catalog.list()) {
        tables.set(t.name, t.rows);
      }
      if (extras.tableOverrides) {
        for (const [k, v] of extras.tableOverrides) {
          tables.set(k, v);
        }
      }

      const source =
        extras.sourceRowsOverride ??
        tables.get(program.startWith) ??
        catalog.rows(program.startWith);

      const rows = applyPipeline(source, steps, tables);
      return {
        programId: program.id,
        programVersion: program.version,
        rowCount: rows.length,
        contentHash: hashRows(rows),
        rows,
        sql: program.sql,
        mode: extras.mode ?? 'FULL',
      };
    },
  };
}

export function applyPipeline(
  input: Row[],
  steps: readonly TransformStep[],
  tables: Map<string, Row[]>,
): Row[] {
  let rows = input.map((r) => ({ ...r }));
  for (const step of steps) {
    const op = getOp(step.kind);
    rows = op.apply(rows, step.params, tables);
  }
  return rows;
}

/**
 * Stub DuckDB: mesmo resultado via memory; SQL já versionado no program.
 * Upgrade: @duckdb/node-api executando program.sql sobre Parquet.
 */
export function createDuckDbExecutorStub(catalog: TableCatalog): TransformExecutor {
  const memory = createMemoryExecutor(catalog);
  return {
    engine: 'duckdb',
    execute(program, extras) {
      return memory.execute(program, extras);
    },
  };
}
