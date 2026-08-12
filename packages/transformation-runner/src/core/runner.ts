/**
 * transformation-runner — src/core/runner.ts
 * Orquestra DSL → program versionado → execução + gate de hash.
 */

import type { TransformProgram, TransformRunResult } from 'contracts';

import { createTableCatalog, type TableCatalog } from './catalog.js';
import { createDslEngine, type DslEngine, type TableDefinition } from './dsl.js';
import {
  applyPipeline,
  createDuckDbExecutorStub,
  createMemoryExecutor,
  type ExecuteOptions,
  type TransformExecutor,
} from './executor.js';
import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { buildLinearDag, hasCycle, type TransformDag } from './dag.js';
import { hashRows } from './hash.js';
import { isIncrementalComputationAvailable } from './incremental.js';
import type { CreateRunnerOptions, NamedTable, Row } from './types.js';

export interface TransformationRunner {
  readonly catalog: TableCatalog;
  readonly dsl: DslEngine;
  readonly executor: TransformExecutor;
  registerTable(table: NamedTable): void;
  build(def: TableDefinition, version?: number): TransformProgram;
  run(program: TransformProgram, extras?: ExecuteOptions): TransformRunResult;
  /** Gate: duas runs com mesmo input → mesmo contentHash. */
  assertDeterministic(program: TransformProgram): { ok: boolean; hash: string };
  dagFor(program: TransformProgram): TransformDag;
  canIncremental(program: TransformProgram): boolean;
  /**
   * Computação incremental (CONCATENATE): transforma base e delta separadamente
   * e concatena. Outros tipos → FULL recompute após append.
   */
  performIncrementalComputation(
    program: TransformProgram,
    appended: readonly Row[],
  ): TransformRunResult;
}

export function createTransformationRunner(
  options: CreateRunnerOptions & { engine?: 'memory' | 'duckdb' } = {},
): TransformationRunner {
  const clock = options.clock ?? createDeterministicClock();
  const nextId = options.nextId ?? createIdGenerator();
  const catalog = createTableCatalog();
  const dsl = createDslEngine({ clock, nextId });
  const engine = options.engine ?? 'memory';
  const executor: TransformExecutor =
    engine === 'duckdb'
      ? createDuckDbExecutorStub(catalog)
      : createMemoryExecutor(catalog);

  const customFns = new Map<
    string,
    (rows: Record<string, unknown>[]) => Record<string, unknown>[]
  >();

  const originalCustom = dsl.createCustomizedTransformation.bind(dsl);
  dsl.createCustomizedTransformation = (name, fn) => {
    customFns.set(name, fn);
    return originalCustom(name, fn);
  };

  function hydrate(program: TransformProgram): TransformProgram {
    return {
      ...program,
      steps: program.steps.map((s) => {
        if (s.kind !== 'custom') return s;
        const name = String(s.params.name ?? '');
        const fn = customFns.get(name);
        return fn ? { ...s, params: { ...s.params, fn } } : s;
      }),
    };
  }

  return {
    catalog,
    dsl,
    executor,
    registerTable(table) {
      catalog.register(table);
    },
    build(def, version) {
      return dsl.buildProgram(def, version);
    },
    run(program, extras) {
      return executor.execute(hydrate(program), extras);
    },
    assertDeterministic(program) {
      const a = executor.execute(hydrate(program));
      const b = executor.execute(hydrate(program));
      return { ok: a.contentHash === b.contentHash, hash: a.contentHash };
    },
    dagFor(program) {
      const dag = buildLinearDag(
        program.id,
        program.startWith,
        program.steps.map((s) => s.kind),
      );
      if (hasCycle(dag)) throw new Error('DAG cíclico');
      return dag;
    },
    canIncremental(program) {
      return isIncrementalComputationAvailable(program.steps);
    },
    performIncrementalComputation(program, appended) {
      const hydrated = hydrate(program);
      const before = catalog.rows(program.startWith);
      catalog.append(program.startWith, appended);

      if (program.computability !== 'CONCATENATE') {
        return executor.execute(hydrated, { mode: 'FULL' });
      }

      const tablesBase = new Map<string, Row[]>();
      for (const t of catalog.list()) {
        tablesBase.set(t.name, t.name === program.startWith ? before : t.rows);
      }
      const baseOut = applyPipeline(before, hydrated.steps, tablesBase);

      const tablesDelta = new Map(tablesBase);
      tablesDelta.set(program.startWith, [...appended]);
      const deltaOut = applyPipeline([...appended], hydrated.steps, tablesDelta);

      const rows = [...baseOut, ...deltaOut];
      return {
        programId: program.id,
        programVersion: program.version,
        rowCount: rows.length,
        contentHash: hashRows(rows),
        rows,
        sql: program.sql,
        mode: 'INCREMENTAL',
      };
    },
  };
}
