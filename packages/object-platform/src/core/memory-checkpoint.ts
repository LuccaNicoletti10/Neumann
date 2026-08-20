/**
 * Rollback primitive for the memory test double.
 *
 * WHY: a throw after objects.create is not invertible by hand (history, events,
 * outbox, ledger claim), so each store exposes capture/restore of its own
 * generation. Serialization of concurrent transactions is not this module's
 * job — see memory-transaction-boundary.ts.
 */

export interface MemoryCheckpoint {
  capture(): unknown;
  restore(snapshot: unknown): void;
}

export function isMemoryCheckpoint(value: unknown): value is MemoryCheckpoint {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as MemoryCheckpoint;
  return typeof c.capture === 'function' && typeof c.restore === 'function';
}

export function restoreMap<K, V>(target: Map<K, V>, snapshot: Map<K, V>): void {
  target.clear();
  for (const [k, v] of snapshot) target.set(k, v);
}

export function restoreArray<T>(target: T[], snapshot: readonly T[]): void {
  target.length = 0;
  target.push(...snapshot);
}

