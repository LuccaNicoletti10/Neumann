/**
 * schema-registry — src/core/typesystem.ts
 * Hierarquia de tipos físicos e regras de widening/narrowing para drift.
 */

import type { PhysicalType } from './types.js';

/** Ordem de widening numérico (índice maior = mais largo). */
const NUMERIC_RANK: Partial<Record<PhysicalType, number>> = {
  boolean: 0,
  integer: 1,
  bigint: 2,
  decimal: 3,
  float: 3,
};

/** Ordem de widening temporal. */
const TEMPORAL_RANK: Partial<Record<PhysicalType, number>> = {
  date: 0,
  datetime: 1,
};

/**
 * `to` é um widening válido de `from` (coercible).
 * Qualquer tipo → string é widening. Unknown nunca participa.
 */
export function isWidening(from: PhysicalType, to: PhysicalType): boolean {
  if (from === to) return false;
  if (from === 'unknown' || to === 'unknown') return false;
  if (to === 'string') return true;
  if (to === 'json' && from === 'string') return true;

  const fromNum = NUMERIC_RANK[from];
  const toNum = NUMERIC_RANK[to];
  if (fromNum !== undefined && toNum !== undefined) {
    return toNum > fromNum;
  }

  const fromT = TEMPORAL_RANK[from];
  const toT = TEMPORAL_RANK[to];
  if (fromT !== undefined && toT !== undefined) {
    return toT > fromT;
  }

  return false;
}

/** `to` é um narrowing (breaking) de `from`. */
export function isNarrowing(from: PhysicalType, to: PhysicalType): boolean {
  if (from === to) return false;
  if (from === 'unknown' || to === 'unknown') return false;
  return isWidening(to, from);
}

/** Tipos incompatíveis (nem equal, nem widen, nem narrow reconhecido). */
export function isIncompatible(from: PhysicalType, to: PhysicalType): boolean {
  if (from === to) return false;
  if (from === 'unknown' || to === 'unknown') return true;
  if (isWidening(from, to) || isNarrowing(from, to)) return false;
  return true;
}

const ALIASES: Record<string, PhysicalType> = {
  bool: 'boolean',
  boolean: 'boolean',
  int: 'integer',
  integer: 'integer',
  int32: 'integer',
  int64: 'bigint',
  bigint: 'bigint',
  long: 'bigint',
  number: 'float',
  float: 'float',
  double: 'float',
  decimal: 'decimal',
  numeric: 'decimal',
  string: 'string',
  text: 'string',
  varchar: 'string',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  timestamptz: 'datetime',
  json: 'json',
  jsonb: 'json',
  object: 'json',
  unknown: 'unknown',
};

/** Normaliza um rótulo de tipo (pandas/SQL/JS) para PhysicalType. */
export function normalizePhysicalType(raw: string): PhysicalType {
  const key = raw.trim().toLowerCase().replace(/^object$/, 'string');
  // pandas dtypes: int64, float64, datetime64[ns], ...
  if (/^int\d*$/.test(key)) return key.includes('64') ? 'bigint' : 'integer';
  if (/^float\d*$/.test(key)) return 'float';
  if (key.startsWith('datetime') || key.startsWith('timestamp')) return 'datetime';
  if (key === 'bool' || key === 'boolean') return 'boolean';
  return ALIASES[key] ?? 'unknown';
}
