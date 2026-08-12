/**
 * transformation-runner — src/core/ops.ts
 * Operações tipadas do pipeline DSL (filter/join/sort/aggregate/drop/rename/distinct/select/custom).
 */

import type { IncrementalComputability, IncrementalStatus, TransformOpKind } from 'contracts';

import type { Row } from './types.js';

export type OpParams = Record<string, unknown>;

export interface OpSpec {
  kind: TransformOpKind;
  defaultComputability: IncrementalComputability;
  defaultStatus: IncrementalStatus;
  toSql: (params: OpParams, inputAlias: string) => string;
  apply: (rows: Row[], params: OpParams, tables?: Map<string, Row[]>) => Row[];
}

function asString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`param ${name} deve ser string`);
  }
  return v;
}

function asStringArray(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new Error(`param ${name} deve ser string[]`);
  }
  return v as string[];
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export const OPS: Record<TransformOpKind, OpSpec> = {
  filter: {
    kind: 'filter',
    defaultComputability: 'CONCATENATE',
    defaultStatus: 'INCREMENTAL',
    toSql(params, input) {
      const column = asString(params.column, 'column');
      const values = params.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error('filter.values obrigatório');
      }
      const list = values.map(sqlLiteral).join(', ');
      return `SELECT * FROM ${input} WHERE ${quoteIdent(column)} IN (${list})`;
    },
    apply(rows, params) {
      const column = asString(params.column, 'column');
      const values = params.values;
      if (!Array.isArray(values)) throw new Error('filter.values obrigatório');
      const set = new Set(values.map((v) => canonicalizeCell(v)));
      return rows.filter((r) => set.has(canonicalizeCell(r[column])));
    },
  },

  join: {
    kind: 'join',
    defaultComputability: 'CONCATENATE',
    defaultStatus: 'INCREMENTAL',
    toSql(params, input) {
      const right = asString(params.right, 'right');
      const leftKey = asString(params.leftKey, 'leftKey');
      const rightKey = asString(params.rightKey, 'rightKey');
      return (
        `SELECT l.*, r.* FROM ${input} AS l ` +
        `INNER JOIN ${quoteIdent(right)} AS r ` +
        `ON l.${quoteIdent(leftKey)} = r.${quoteIdent(rightKey)}`
      );
    },
    apply(rows, params, tables) {
      const rightName = asString(params.right, 'right');
      const leftKey = asString(params.leftKey, 'leftKey');
      const rightKey = asString(params.rightKey, 'rightKey');
      const rightRows = tables?.get(rightName) ?? [];
      const out: Row[] = [];
      for (const l of rows) {
        for (const r of rightRows) {
          if (canonicalizeCell(l[leftKey]) === canonicalizeCell(r[rightKey])) {
            const rightPrefixed: Row = {};
            for (const [k, v] of Object.entries(r)) {
              // Evita clobber de colunas do left; espelha join SQL com alias.
              const dest = Object.prototype.hasOwnProperty.call(l, k)
                ? `${rightName}.${k}`
                : k;
              rightPrefixed[dest] = v;
            }
            out.push({ ...l, ...rightPrefixed });
          }
        }
      }
      return out;
    },
  },

  sort: {
    kind: 'sort',
    defaultComputability: 'IMPOSSIBLE',
    defaultStatus: 'FULL',
    toSql(params, input) {
      const column = asString(params.column, 'column');
      const ascending = params.ascending !== false;
      return `SELECT * FROM ${input} ORDER BY ${quoteIdent(column)} ${ascending ? 'ASC' : 'DESC'}`;
    },
    apply(rows, params) {
      const column = asString(params.column, 'column');
      const ascending = params.ascending !== false;
      const copy = [...rows];
      copy.sort((a, b) => {
        const c = cmp(a[column], b[column]);
        return ascending ? c : -c;
      });
      return copy;
    },
  },

  aggregate: {
    kind: 'aggregate',
    defaultComputability: 'MERGE_AND_REPLACE',
    defaultStatus: 'FULL',
    toSql(params, input) {
      const groupBy = asStringArray(params.groupBy ?? [], 'groupBy');
      const column = asString(params.column, 'column');
      const op = String(params.op ?? 'sum').toUpperCase();
      const gb = groupBy.map(quoteIdent).join(', ');
      const select = gb
        ? `${gb}, ${op}(${quoteIdent(column)}) AS ${quoteIdent(String(params.as ?? 'value'))}`
        : `${op}(${quoteIdent(column)}) AS ${quoteIdent(String(params.as ?? 'value'))}`;
      return gb
        ? `SELECT ${select} FROM ${input} GROUP BY ${gb}`
        : `SELECT ${select} FROM ${input}`;
    },
    apply(rows, params) {
      const groupBy = (params.groupBy as string[] | undefined) ?? [];
      const column = asString(params.column, 'column');
      const op = String(params.op ?? 'sum').toLowerCase();
      const as = String(params.as ?? 'value');

      if (groupBy.length === 0) {
        const nums = rows.map((r) => Number(r[column]) || 0);
        const value = reduceOp(nums, op);
        return [{ [as]: value }];
      }

      const groups = new Map<string, { keys: Row; nums: number[] }>();
      for (const row of rows) {
        const keys: Row = {};
        for (const g of groupBy) keys[g] = row[g];
        const k = JSON.stringify(keys);
        let g = groups.get(k);
        if (!g) {
          g = { keys, nums: [] };
          groups.set(k, g);
        }
        g.nums.push(Number(row[column]) || 0);
      }
      const out: Row[] = [];
      for (const g of groups.values()) {
        out.push({ ...g.keys, [as]: reduceOp(g.nums, op) });
      }
      out.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
      return out;
    },
  },

  drop: {
    kind: 'drop',
    defaultComputability: 'CONCATENATE',
    defaultStatus: 'INCREMENTAL',
    toSql(params, input) {
      const columns = asStringArray(params.columns, 'columns');
      return `SELECT * EXCLUDE (${columns.map(quoteIdent).join(', ')}) FROM ${input}`;
    },
    apply(rows, params) {
      const columns = new Set(asStringArray(params.columns, 'columns'));
      return rows.map((row) => {
        const next: Row = {};
        for (const [k, v] of Object.entries(row)) {
          if (!columns.has(k)) next[k] = v;
        }
        return next;
      });
    },
  },

  rename: {
    kind: 'rename',
    defaultComputability: 'CONCATENATE',
    defaultStatus: 'INCREMENTAL',
    toSql(params, input) {
      const from = asString(params.from, 'from');
      const to = asString(params.to, 'to');
      return `SELECT * RENAME (${quoteIdent(from)} AS ${quoteIdent(to)}) FROM ${input}`;
    },
    apply(rows, params) {
      const from = asString(params.from, 'from');
      const to = asString(params.to, 'to');
      return rows.map((row) => {
        const next: Row = { ...row };
        if (Object.prototype.hasOwnProperty.call(next, from)) {
          next[to] = next[from];
          delete next[from];
        }
        return next;
      });
    },
  },

  distinct: {
    kind: 'distinct',
    defaultComputability: 'MERGE_AND_APPEND',
    defaultStatus: 'INCREMENTAL',
    toSql(_params, input) {
      return `SELECT DISTINCT * FROM ${input}`;
    },
    apply(rows) {
      const seen = new Set<string>();
      const out: Row[] = [];
      for (const row of rows) {
        const k = JSON.stringify(sortKeys(row));
        if (!seen.has(k)) {
          seen.add(k);
          out.push(row);
        }
      }
      return out;
    },
  },

  select: {
    kind: 'select',
    defaultComputability: 'CONCATENATE',
    defaultStatus: 'INCREMENTAL',
    toSql(params, input) {
      const columns = asStringArray(params.columns, 'columns');
      return `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${input}`;
    },
    apply(rows, params) {
      const columns = asStringArray(params.columns, 'columns');
      return rows.map((row) => {
        const next: Row = {};
        for (const c of columns) next[c] = row[c];
        return next;
      });
    },
  },

  custom: {
    kind: 'custom',
    defaultComputability: 'IMPOSSIBLE',
    defaultStatus: 'FULL',
    toSql(params, input) {
      const name = asString(params.name, 'name');
      return `-- CUSTOM ${name}\nSELECT * FROM ${input}`;
    },
    apply(rows, params) {
      const fn = params.fn;
      if (typeof fn !== 'function') {
        throw new Error('custom.fn deve ser (rows) => rows');
      }
      const result = (fn as (r: Row[]) => Row[])(rows);
      if (!Array.isArray(result)) throw new Error('custom.fn deve retornar Row[]');
      return result;
    },
  },
};

function reduceOp(nums: number[], op: string): number {
  if (nums.length === 0) return 0;
  switch (op) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'count':
      return nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    default:
      throw new Error(`aggregate.op desconhecido: ${op}`);
  }
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`identificador inválido: ${name}`);
  }
  return `"${name}"`;
}

function canonicalizeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(sortKeys(v));
  return String(v);
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

export function getOp(kind: TransformOpKind): OpSpec {
  const op = OPS[kind];
  if (!op) throw new Error(`op desconhecida: ${kind}`);
  return op;
}
