/**
 * schema-registry — src/core/discover.ts
 *
 * US 9,330,120 — descoberta automática de schema de fontes novas
 * (backend da importação visual/assistida). Infere colunas, tipos físicos,
 * hints semânticos e chaves candidatas a partir de amostras tabulares.
 */

import { normalizePhysicalType } from './typesystem.js';
import type { ObservedColumn, ObservedSchema, PhysicalType } from './types.js';
import { CoreError } from './types.js';

export interface DiscoverInput {
  source: string;
  object: string;
  /** Linhas amostradas da fonte (objetos chave→valor). */
  rows: readonly Record<string, unknown>[];
  /** Declaração opcional de PK / FKs. */
  primaryKey?: string | string[];
  foreignKeys?: Record<string, string[]>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;
const URL_RE = /^https?:\/\//i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?\d*\.\d+$/;
const BOOL_RE = /^(true|false|0|1|yes|no)$/i;

function inferTypeFromValues(values: readonly unknown[]): PhysicalType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return 'unknown';

  if (nonNull.every((v) => typeof v === 'boolean' || BOOL_RE.test(String(v)))) {
    return 'boolean';
  }
  if (nonNull.every((v) => typeof v === 'number' && Number.isInteger(v))) {
    return 'integer';
  }
  if (nonNull.every((v) => typeof v === 'number')) {
    return 'float';
  }
  if (nonNull.every((v) => typeof v === 'object')) {
    return 'json';
  }

  const asStrings = nonNull.map((v) => String(v));
  if (asStrings.every((s) => DATETIME_RE.test(s))) return 'datetime';
  if (asStrings.every((s) => DATE_RE.test(s))) return 'date';
  if (asStrings.every((s) => INT_RE.test(s))) return 'integer';
  if (asStrings.every((s) => FLOAT_RE.test(s) || INT_RE.test(s))) return 'float';
  if (asStrings.every((s) => BOOL_RE.test(s))) return 'boolean';
  return 'string';
}

function inferHint(column: string, values: readonly unknown[]): string | undefined {
  const name = column.toLowerCase();
  if (name.includes('email')) return 'email';
  if (name.includes('phone') || name.includes('tel')) return 'phone';
  if (name.includes('url') || name.includes('website')) return 'url';
  if (name.includes('lat')) return 'latitude';
  if (name.includes('lon') || name.includes('lng')) return 'longitude';
  if (name === 'id' || name.endsWith('_id')) return 'identifier';

  const samples = values
    .filter((v) => v !== null && v !== undefined && v !== '')
    .slice(0, 5)
    .map(String);
  if (samples.length > 0 && samples.every((s) => EMAIL_RE.test(s))) return 'email';
  if (samples.length > 0 && samples.every((s) => PHONE_RE.test(s))) return 'phone';
  if (samples.length > 0 && samples.every((s) => URL_RE.test(s))) return 'url';
  return undefined;
}

/**
 * Descobre o schema de uma fonte nova a partir de amostras de linhas.
 * Equivalente funcional ao passo de análise do Visual Data Importer.
 */
export function discover(input: DiscoverInput): ObservedSchema {
  if (input.source.trim() === '' || input.object.trim() === '') {
    throw new CoreError('INVALID_DISCOVER', 'source e object são obrigatórios');
  }
  if (input.rows.length === 0) {
    throw new CoreError('INVALID_DISCOVER', 'discover exige ao menos uma linha amostrada');
  }

  const columnNames = new Set<string>();
  for (const row of input.rows) {
    for (const key of Object.keys(row)) columnNames.add(key);
  }
  const sorted = [...columnNames].sort();

  const pkSet = new Set(
    input.primaryKey === undefined
      ? []
      : Array.isArray(input.primaryKey)
        ? input.primaryKey
        : [input.primaryKey],
  );

  const columns: ObservedColumn[] = sorted.map((column) => {
    const values = input.rows.map((row) => row[column]);
    const nonNullCount = values.filter((v) => v !== null && v !== undefined && v !== '').length;
    const physicalType = inferTypeFromValues(values);
    const hint = inferHint(column, values);
    const col: ObservedColumn = {
      column,
      physicalType,
      nullable: nonNullCount < values.length,
      isPrimaryKey: pkSet.has(column),
      foreignKeys: [...(input.foreignKeys?.[column] ?? [])],
      sampleValues: values
        .filter((v) => v !== null && v !== undefined)
        .slice(0, 5)
        .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))),
    };
    if (hint !== undefined) col.semanticHint = hint;
    return col;
  });

  // Heurística de PK: coluna "id" única e não-nullable.
  if (pkSet.size === 0) {
    const idCol = columns.find((c) => c.column.toLowerCase() === 'id' && !c.nullable);
    if (idCol !== undefined) {
      const values = input.rows.map((r) => r[idCol.column]);
      const unique = new Set(values.map((v) => String(v))).size === values.length;
      if (unique) idCol.isPrimaryKey = true;
    }
  }

  return {
    source: input.source,
    object: input.object,
    columns,
  };
}

/** Parse CSV simples (sem aspas aninhadas complexas) → linhas. */
export function parseCsvSample(csvText: string, maxRows = 50): Record<string, unknown>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new CoreError('INVALID_CSV', 'CSV precisa de cabeçalho + ao menos 1 linha');
  }
  const header = splitCsvLine(lines[0]!);
  const rows: Record<string, unknown>[] = [];
  for (const line of lines.slice(1, maxRows + 1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    header.forEach((name, i) => {
      row[name] = coerceCell(cells[i] ?? '');
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function coerceCell(raw: string): unknown {
  if (raw === '') return null;
  if (BOOL_RE.test(raw) && (raw.toLowerCase() === 'true' || raw.toLowerCase() === 'false')) {
    return raw.toLowerCase() === 'true';
  }
  if (INT_RE.test(raw)) return Number(raw);
  if (FLOAT_RE.test(raw)) return Number(raw);
  return raw;
}

/** Aceita tipo já tipado (ex.: de um connector) e normaliza. */
export function normalizeObservedColumns(
  columns: readonly {
    column: string;
    physicalType: string;
    nullable?: boolean;
    isPrimaryKey?: boolean;
    foreignKeys?: string[];
    semanticHint?: string;
    sampleValues?: string[];
  }[],
): ObservedColumn[] {
  return columns.map((c) => {
    const col: ObservedColumn = {
      column: c.column,
      physicalType: normalizePhysicalType(c.physicalType),
      nullable: c.nullable ?? true,
      isPrimaryKey: c.isPrimaryKey ?? false,
      foreignKeys: [...(c.foreignKeys ?? [])],
      sampleValues: [...(c.sampleValues ?? [])],
    };
    if (c.semanticHint !== undefined) col.semanticHint = c.semanticHint;
    return col;
  });
}
