/**
 * transformation-runner — src/core/dsl.ts
 * TableDefinition: newTable / startWith / transformation / privateTable / custom.
 */

import type { TransformOpKind, TransformProgram, TransformStep } from 'contracts';

import { getOp, type OpParams } from './ops.js';
import type { Clock, IdGenerator } from './types.js';
import { compileProgramSql } from './sql.js';
import { analyzeIncremental } from './incremental.js';

export interface TableDefinition {
  name: string;
  startWith: string | null;
  steps: TransformStep[];
  privateTables: TableDefinition[];
  isPrivate: boolean;
}

export interface DslEngine {
  newTable(name: string): TableDefinition;
  privateTable(name: string): TableDefinition;
  startWith(def: TableDefinition, source: string): void;
  transformation(def: TableDefinition, kind: TransformOpKind, params?: OpParams): void;
  createCustomizedTransformation(
    name: string,
    fn: (rows: Record<string, unknown>[]) => Record<string, unknown>[],
  ): TransformStep;
  addPrivateTable(parent: TableDefinition, child: TableDefinition): void;
  /** Materializa TransformProgram versionado (SQL + metadados incrementais). */
  buildProgram(def: TableDefinition, version?: number): TransformProgram;
  getCustom(name: string): TransformStep | undefined;
}

export function createDslEngine(deps: {
  clock: Clock;
  nextId: IdGenerator;
}): DslEngine {
  const customs = new Map<string, TransformStep>();

  function newTable(name: string): TableDefinition {
    return {
      name,
      startWith: null,
      steps: [],
      privateTables: [],
      isPrivate: false,
    };
  }

  function privateTable(name: string): TableDefinition {
    const t = newTable(name);
    t.isPrivate = true;
    return t;
  }

  function startWith(def: TableDefinition, source: string): void {
    def.startWith = source;
  }

  function transformation(
    def: TableDefinition,
    kind: TransformOpKind,
    params: OpParams = {},
  ): void {
    const op = getOp(kind);
    const step: TransformStep = {
      kind,
      params: { ...params },
      sqlFragment: op.toSql(params, '__input__'),
    };
    // custom com fn não serializa no program JSON — apenas nome
    if (kind === 'custom') {
      const name = String(params.name ?? 'custom');
      const registered = customs.get(name);
      if (registered) {
        def.steps.push({
          kind: 'custom',
          params: { name },
          sqlFragment: registered.sqlFragment,
        });
        return;
      }
    }
    def.steps.push(step);
  }

  function createCustomizedTransformation(
    name: string,
    fn: (rows: Record<string, unknown>[]) => Record<string, unknown>[],
  ): TransformStep {
    const step: TransformStep = {
      kind: 'custom',
      params: { name, fn },
      sqlFragment: `-- CUSTOM ${name}`,
    };
    customs.set(name, step);
    return step;
  }

  function addPrivateTable(parent: TableDefinition, child: TableDefinition): void {
    child.isPrivate = true;
    parent.privateTables.push(child);
  }

  function buildProgram(def: TableDefinition, version = 1): TransformProgram {
    if (!def.startWith) {
      throw new Error(`table ${def.name}: startWith obrigatório`);
    }
    const steps = materializeSteps(def);
    const analysis = analyzeIncremental(steps);
    const sql = compileProgramSql(def.startWith, steps);
    return {
      id: deps.nextId('prog'),
      name: def.name,
      version,
      startWith: def.startWith,
      steps: steps.map(stripFns),
      sql,
      createdAt: deps.clock(),
      incrementalStatus: analysis.status,
      computability: analysis.computability,
    };
  }

  function materializeSteps(def: TableDefinition): TransformStep[] {
    const steps: TransformStep[] = [];
    for (const priv of def.privateTables) {
      // private tables are separate programs; join step may reference them by name
      void priv;
    }
    for (const step of def.steps) {
      if (step.kind === 'custom') {
        const name = String(step.params.name ?? '');
        const custom = customs.get(name);
        if (custom) {
          steps.push({
            kind: 'custom',
            params: { name, fn: custom.params.fn },
            sqlFragment: custom.sqlFragment,
          });
          continue;
        }
      }
      steps.push(step);
    }
    return steps;
  }

  return {
    newTable,
    privateTable,
    startWith,
    transformation,
    createCustomizedTransformation,
    addPrivateTable,
    buildProgram,
    getCustom: (name) => customs.get(name),
  };
}

function stripFns(step: TransformStep): TransformStep {
  if (step.kind !== 'custom') return step;
  const { fn: _fn, ...rest } = step.params;
  return { ...step, params: rest };
}
