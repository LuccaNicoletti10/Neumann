/**
 * transformation-runner — src/core/sql.ts
 * Compila pipeline DSL → SQL versionado (estilo DuckDB).
 */

import type { TransformStep } from 'contracts';

import { getOp } from './ops.js';

/** Compila steps em SQL aninhado determinístico (sem NOW()/rand). */
export function compileProgramSql(startWith: string, steps: readonly TransformStep[]): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(startWith)) {
    throw new Error(`startWith inválido: ${startWith}`);
  }

  if (steps.length === 0) {
    return `-- NEUMANN transform program (deterministic; no wall-clock fns)
SELECT * FROM "${startWith}";\n`;
  }

  let expr = `"${startWith}"`;
  for (const step of steps) {
    const op = getOp(step.kind);
    const inner = op.toSql(step.params, expr);
    expr = `(${inner})`;
  }
  return `-- NEUMANN transform program (deterministic; no wall-clock fns)\n${expr};\n`;
}
