/**
 * federation — src/core/pushdown.ts
 * Avalia PushdownSpec sobre linhas da fonte (simula WHERE/projection).
 */

import type { FederatedRow, PushdownPredicate, PushdownSpec } from 'contracts';

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function cmp(left: unknown, right: unknown): number | undefined {
  if (left === right) return 0;
  const ln = asNumber(left);
  const rn = asNumber(right);
  if (ln !== undefined && rn !== undefined) return ln < rn ? -1 : ln > rn ? 1 : 0;
  const ls = String(left);
  const rs = String(right);
  return ls < rs ? -1 : ls > rs ? 1 : 0;
}

export function matchPredicate(fields: Record<string, unknown>, pred: PushdownPredicate): boolean {
  const left = fields[pred.field];
  switch (pred.op) {
    case 'eq':
      return left === pred.value;
    case 'neq':
      return left !== pred.value;
    case 'in':
      return Array.isArray(pred.value) && pred.value.includes(left);
    case 'contains':
      return String(left ?? '').toLowerCase().includes(String(pred.value ?? '').toLowerCase());
    case 'gt':
      return (cmp(left, pred.value) ?? 0) > 0;
    case 'gte':
      return (cmp(left, pred.value) ?? 0) >= 0;
    case 'lt':
      return (cmp(left, pred.value) ?? 0) < 0;
    case 'lte':
      return (cmp(left, pred.value) ?? 0) <= 0;
    default:
      return false;
  }
}

export function applyPushdown(
  rows: FederatedRow[],
  spec: PushdownSpec,
): FederatedRow[] {
  let out = rows;
  if (spec.primaryKeys?.length) {
    const keys = new Set(spec.primaryKeys);
    out = out.filter((r) => keys.has(r.objectId));
  }
  if (spec.predicates?.length) {
    out = out.filter((r) => spec.predicates!.every((p) => matchPredicate(r.fields, p)));
  }
  if (spec.columns?.length) {
    const cols = new Set(spec.columns);
    out = out.map((r) => {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.fields)) {
        if (cols.has(k)) fields[k] = v;
      }
      return { ...r, fields };
    });
  }
  if (spec.limit !== undefined && spec.limit >= 0) {
    out = out.slice(0, spec.limit);
  }
  return out;
}

export function isPushedDown(spec: PushdownSpec): boolean {
  return Boolean(
    (spec.primaryKeys && spec.primaryKeys.length > 0) ||
      (spec.predicates && spec.predicates.length > 0) ||
      (spec.columns && spec.columns.length > 0),
  );
}
