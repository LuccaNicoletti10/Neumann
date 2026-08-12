/**
 * delta-storage — src/core/apply.ts
 * Aplicação de DeltaOp sobre objetos JSON (deep clone na escrita).
 */

import type { DeltaOp } from 'contracts';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Clone estrutural profundo (JSON-safe). */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (!isPlainObject(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deletePath(root: Record<string, unknown>, path: string): void {
  const parts = path.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]!];
    if (!isPlainObject(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]!];
}

/** Aplica uma op; retorna novo estado (não muta o original). */
export function applyOp(state: unknown, op: DeltaOp): unknown {
  if (!isPlainObject(state)) {
    throw new Error('applyOp: estado deve ser objeto');
  }
  const next = deepClone(state);
  switch (op.type) {
    case 'update':
      setPath(next, op.path, deepClone(op.value));
      break;
    case 'delete':
      deletePath(next, op.path);
      break;
    case 'add':
      next[op.key] = deepClone(op.value);
      break;
    default: {
      const _exhaustive: never = op;
      throw new Error(`op desconhecida: ${JSON.stringify(_exhaustive)}`);
    }
  }
  return next;
}

export function applyOps(state: unknown, ops: readonly DeltaOp[]): unknown {
  let cur = state;
  for (const op of ops) {
    cur = applyOp(cur, op);
  }
  return cur;
}

/**
 * Diff simples estadoA → estadoB como lista de updates de topo + deletes.
 * Suficiente para gerar Δ entre snapshots conhecidos.
 */
export function diffStates(before: unknown, after: unknown): DeltaOp[] {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    throw new Error('diffStates: ambos devem ser objetos');
  }
  const ops: DeltaOp[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    const a = before[key];
    const b = after[key];
    if (!(key in after)) {
      ops.push({ type: 'delete', path: key });
    } else if (!(key in before)) {
      ops.push({ type: 'add', key, value: b });
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      // nested: se ambos objetos, recurse com path prefix
      if (isPlainObject(a) && isPlainObject(b)) {
        for (const nested of diffStates(a, b)) {
          if (nested.type === 'update') {
            ops.push({ type: 'update', path: `${key}.${nested.path}`, value: nested.value });
          } else if (nested.type === 'delete') {
            ops.push({ type: 'delete', path: `${key}.${nested.path}` });
          } else {
            ops.push({ type: 'update', path: `${key}.${nested.key}`, value: nested.value });
          }
        }
      } else {
        ops.push({ type: 'update', path: key, value: b });
      }
    }
  }
  return ops;
}
