/**
 * schema-registry — src/core/drift.ts
 * Classificador: compatible / coercible / breaking / unknown + ação definida.
 */

import { createDeterministicClock } from './determinism.js';
import { isIncompatible, isNarrowing, isWidening } from './typesystem.js';
import type {
  Clock,
  ColumnChange,
  ColumnSchema,
  DriftAction,
  DriftKind,
  DriftReport,
  ObservedColumn,
  ObservedSchema,
  ObjectSchema,
  TypeCast,
} from './types.js';

function indexByColumn(columns: readonly ColumnSchema[]): Map<string, ColumnSchema> {
  return new Map(columns.map((c) => [c.column, c]));
}

function indexObserved(columns: readonly ObservedColumn[]): Map<string, ObservedColumn> {
  return new Map(columns.map((c) => [c.column, c]));
}

/**
 * Diff coluna a coluna entre schema registrado e observado.
 * Determinístico: ordem alfabética dos nomes de coluna.
 */
export function diffColumns(
  registered: readonly ColumnSchema[],
  observed: readonly ObservedColumn[],
): ColumnChange[] {
  const reg = indexByColumn(registered);
  const obs = indexObserved(observed);
  const names = [...new Set([...reg.keys(), ...obs.keys()])].sort();
  const changes: ColumnChange[] = [];

  for (const name of names) {
    const r = reg.get(name);
    const o = obs.get(name);
    if (r === undefined && o !== undefined) {
      changes.push({
        column: name,
        kind: 'added',
        toType: o.physicalType,
        toNullable: o.nullable,
      });
      continue;
    }
    if (r !== undefined && o === undefined) {
      changes.push({
        column: name,
        kind: 'removed',
        fromType: r.physicalType,
        fromNullable: r.nullable,
      });
      continue;
    }
    if (r === undefined || o === undefined) continue;

    if (r.isPrimaryKey !== (o.isPrimaryKey ?? false)) {
      changes.push({
        column: name,
        kind: 'pk_changed',
        fromType: r.physicalType,
        toType: o.physicalType,
      });
    }

    if (r.physicalType !== o.physicalType) {
      if (r.physicalType === 'unknown' || o.physicalType === 'unknown') {
        changes.push({
          column: name,
          kind: 'type_unknown',
          fromType: r.physicalType,
          toType: o.physicalType,
        });
      } else if (isWidening(r.physicalType, o.physicalType)) {
        changes.push({
          column: name,
          kind: 'type_widened',
          fromType: r.physicalType,
          toType: o.physicalType,
        });
      } else if (isNarrowing(r.physicalType, o.physicalType)) {
        changes.push({
          column: name,
          kind: 'type_narrowed',
          fromType: r.physicalType,
          toType: o.physicalType,
        });
      } else if (isIncompatible(r.physicalType, o.physicalType)) {
        changes.push({
          column: name,
          kind: 'type_unknown',
          fromType: r.physicalType,
          toType: o.physicalType,
        });
      }
    }

    if (r.nullable !== o.nullable) {
      changes.push({
        column: name,
        kind: o.nullable ? 'nullability_relaxed' : 'nullability_tightened',
        fromNullable: r.nullable,
        toNullable: o.nullable,
        fromType: r.physicalType,
        toType: o.physicalType,
      });
    }

    if (
      r.physicalType === o.physicalType &&
      r.nullable === o.nullable &&
      r.isPrimaryKey === (o.isPrimaryKey ?? false) &&
      !changes.some((c) => c.column === name)
    ) {
      changes.push({ column: name, kind: 'unchanged', fromType: r.physicalType, toType: o.physicalType });
    }
  }

  return changes;
}

function classifyFromChanges(changes: readonly ColumnChange[]): {
  kind: DriftKind;
  action: DriftAction;
  casts: TypeCast[];
  detail: string;
} {
  const meaningful = changes.filter((c) => c.kind !== 'unchanged');
  if (meaningful.length === 0) {
    return {
      kind: 'compatible',
      action: 'accept',
      casts: [],
      detail: 'nenhuma mudança estrutural',
    };
  }

  const hasBreaking = meaningful.some(
    (c) =>
      c.kind === 'removed' ||
      c.kind === 'type_narrowed' ||
      c.kind === 'nullability_tightened' ||
      c.kind === 'pk_changed',
  );
  const hasUnknown = meaningful.some((c) => c.kind === 'type_unknown');
  const hasWidening = meaningful.some((c) => c.kind === 'type_widened');
  const hasAdditive = meaningful.some(
    (c) => c.kind === 'added' || c.kind === 'nullability_relaxed',
  );

  // Colunas adicionadas NÃO-nullable são breaking (não dá para backfill seguro).
  const nonNullableAdd = meaningful.some(
    (c) => c.kind === 'added' && c.toNullable === false,
  );

  if (hasBreaking || nonNullableAdd) {
    const reasons = meaningful
      .filter(
        (c) =>
          c.kind === 'removed' ||
          c.kind === 'type_narrowed' ||
          c.kind === 'nullability_tightened' ||
          c.kind === 'pk_changed' ||
          (c.kind === 'added' && c.toNullable === false),
      )
      .map((c) => `${c.column}:${c.kind}`)
      .join(', ');
    return {
      kind: 'breaking',
      action: 'pause_and_alert',
      casts: [],
      detail: `mudança breaking: ${reasons}`,
    };
  }

  if (hasUnknown) {
    const reasons = meaningful
      .filter((c) => c.kind === 'type_unknown')
      .map((c) => `${c.column}:${c.fromType}→${c.toType}`)
      .join(', ');
    return {
      kind: 'unknown',
      action: 'pause_and_alert',
      casts: [],
      detail: `mudança desconhecida: ${reasons}`,
    };
  }

  if (hasWidening) {
    const casts: TypeCast[] = meaningful
      .filter((c) => c.kind === 'type_widened' && c.fromType && c.toType)
      .map((c) => ({
        column: c.column,
        fromType: c.fromType!,
        toType: c.toType!,
      }));
    return {
      kind: 'coercible',
      action: 'accept_with_cast',
      casts,
      detail: `widening coercível: ${casts.map((c) => `${c.column}:${c.fromType}→${c.toType}`).join(', ')}`,
    };
  }

  if (hasAdditive) {
    return {
      kind: 'compatible',
      action: 'accept',
      casts: [],
      detail: 'mudança aditiva compatível (colunas nullable novas ou nullability relaxada)',
    };
  }

  return {
    kind: 'compatible',
    action: 'accept',
    casts: [],
    detail: 'sem mudança estrutural relevante',
  };
}

/**
 * Classifica o drift entre o schema registrado e o observado.
 * Gate T1.4: add/remove/alter coluna → classification + ação definida.
 */
export function classifyDrift(
  registered: ObjectSchema,
  observed: ObservedSchema,
  deps: { clock?: Clock } = {},
): DriftReport {
  const clock = deps.clock ?? createDeterministicClock();
  const changes = diffColumns(registered.columns, observed.columns);
  const { kind, action, casts, detail } = classifyFromChanges(changes);
  return {
    source: registered.source,
    object: registered.object,
    kind,
    action,
    changes,
    registeredVersion: registered.schemaVersion,
    casts,
    detail,
    at: observed.observedAt ?? clock(),
  };
}
