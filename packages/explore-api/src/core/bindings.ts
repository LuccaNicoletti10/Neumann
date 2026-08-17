/**
 * explore-api — src/core/bindings.ts
 * Path de rich objects (US 9,280,532 / US 9,880,993) — sem spreadsheet UI.
 *
 * Slot `c1` liga a um ObjectRecord. Expressão `c1.amount` resolve a propriedade.
 * Autocomplete lista propriedades visíveis do tipo. Dependentes reavaliam.
 */

import type { BindingEvalResult, ObjectRecord, ObjectSlot } from 'contracts';
import type { OntologyAuthorizer } from 'policy-engine';

export interface BindingStore {
  slots: Map<string, ObjectRecord>;
  values: Map<string, unknown>;
  expressions: Map<string, string>;
}

export function createBindingStore(): BindingStore {
  return { slots: new Map(), values: new Map(), expressions: new Map() };
}

export function bindSlot(
  store: BindingStore,
  slotId: string,
  obj: ObjectRecord,
  principal = 'system',
  authorizer?: OntologyAuthorizer,
): ObjectSlot {
  store.slots.set(slotId, obj);
  reevaluateDependents(store, slotId, principal, authorizer);
  return {
    id: slotId,
    objectTypeId: obj.objectTypeId,
    primaryKey: obj.primaryKey,
    objectId: obj.id,
  };
}

export function visibleProperties(
  obj: ObjectRecord,
  principal: string,
  authorizer?: OntologyAuthorizer,
): Record<string, unknown> {
  if (authorizer && !authorizer.canReadObjectType(principal, obj.objectTypeId)) return {};
  if (!authorizer) return { ...obj.properties };
  return authorizer.redactProperties(principal, obj.objectTypeId, obj.properties) as Record<
    string,
    unknown
  >;
}

export function suggestBindings(
  store: BindingStore,
  partial: string,
  principal: string,
  authorizer?: OntologyAuthorizer,
): string[] {
  const trimmed = partial.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot >= 0) {
    const slotId = trimmed.slice(0, dot);
    const prefix = trimmed.slice(dot + 1);
    const obj = store.slots.get(slotId);
    if (!obj) return [];
    return Object.keys(visibleProperties(obj, principal, authorizer))
      .filter((p) => p.startsWith(prefix))
      .slice(0, 20);
  }
  return [...store.slots.keys()].filter((k) => k.startsWith(trimmed)).slice(0, 20);
}

const SLOT_PROP = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;
const SLOT = /^([A-Za-z_][A-Za-z0-9_]*)$/;

function resolveToken(
  token: string,
  store: BindingStore,
  principal: string,
  authorizer?: OntologyAuthorizer,
): unknown {
  const t = token.trim();
  if (t === '') return undefined;
  if (!Number.isNaN(Number(t)) && t !== '') return Number(t);
  const sp = SLOT_PROP.exec(t);
  if (sp) {
    const obj = store.slots.get(sp[1]!);
    if (!obj) return undefined;
    return visibleProperties(obj, principal, authorizer)[sp[2]!];
  }
  const s = SLOT.exec(t);
  if (s) {
    const obj = store.slots.get(s[1]!);
    return obj?.primaryKey;
  }
  return undefined;
}

function collectDeps(expr: string): string[] {
  const deps: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (!deps.includes(m[1]!)) deps.push(m[1]!);
  }
  return deps;
}

export function resolveExpression(
  expr: string,
  store: BindingStore,
): { resolved: string; dependencies: string[] } {
  const dependencies = collectDeps(expr);
  let resolved = expr;
  for (const slotId of dependencies) {
    const obj = store.slots.get(slotId);
    if (!obj) continue;
    const tokenRe = new RegExp(`(^|[^A-Za-z0-9_])(${slotId})(?=\\.)`, 'g');
    resolved = resolved.replace(tokenRe, (_all, before: string) => `${before}${obj.primaryKey}`);
  }
  return { resolved, dependencies };
}

function applyOp(op: string, left: number, right: number): number {
  if (op === '+') return left + right;
  if (op === '-') return left - right;
  if (op === '*') return left * right;
  if (op === '/') return right === 0 ? NaN : left / right;
  return NaN;
}

export function evaluateExpression(
  expr: string,
  store: BindingStore,
  principal: string,
  authorizer?: OntologyAuthorizer,
): BindingEvalResult {
  const raw = expr.startsWith('=') ? expr.slice(1).trim() : expr.trim();
  const { resolved, dependencies } = resolveExpression(raw, store);
  const arith = raw.match(
    /^(.+?)\s*([+\-*/])\s*(.+)$/,
  );
  let value: unknown;
  if (arith) {
    const left = resolveToken(arith[1]!, store, principal, authorizer);
    const right = resolveToken(arith[3]!, store, principal, authorizer);
    value = applyOp(arith[2]!, Number(left), Number(right));
  } else {
    value = resolveToken(raw, store, principal, authorizer);
  }
  return { expression: expr, resolved, value, dependencies };
}

export function setExpression(
  store: BindingStore,
  name: string,
  expr: string,
  principal: string,
  authorizer?: OntologyAuthorizer,
): BindingEvalResult {
  store.expressions.set(name, expr);
  const result = evaluateExpression(expr, store, principal, authorizer);
  store.values.set(name, result.value);
  return result;
}

function reevaluateDependents(
  store: BindingStore,
  slotId: string,
  principal: string,
  authorizer?: OntologyAuthorizer,
): void {
  for (const [name, expr] of store.expressions) {
    const deps = collectDeps(expr.startsWith('=') ? expr.slice(1) : expr);
    if (!deps.includes(slotId)) continue;
    const result = evaluateExpression(expr, store, principal, authorizer);
    store.values.set(name, result.value);
  }
}

/** Projeção de propriedades visíveis (US 9,880,993 — rich object sem GUI). */
export function projectObject(
  obj: ObjectRecord,
  fields: readonly string[],
  principal: string,
  authorizer?: OntologyAuthorizer,
): Record<string, unknown> {
  const visible = visibleProperties(obj, principal, authorizer);
  if (fields.length === 0) return visible;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in visible) out[f] = visible[f];
  }
  return out;
}
