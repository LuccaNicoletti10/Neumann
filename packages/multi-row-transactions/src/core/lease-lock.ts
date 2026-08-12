/**
 * multi-row-transactions — src/core/lease-lock.ts
 * Lease-based locks (US 9,619,507). Expiração via clock injetável — sem setInterval.
 */

import type { Clock, LeaseRecord, LockType } from './types.js';

export interface LockService {
  acquire(lockId: string, lesseeId: string, lockType: LockType): boolean;
  release(lockId: string, lesseeId: string): boolean;
  refresh(lockId: string, lesseeId: string): boolean;
  validate(lockId: string, lesseeId: string): boolean;
  getLease(lockId: string): LeaseRecord | undefined;
  /** Remove leases expirados (chamada explícita — determinística). */
  cleanupExpired(): string[];
}

function parseIso(iso: string): number {
  return Date.parse(iso);
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export function createLockService(deps: {
  clock: Clock;
  leaseMs?: number;
}): LockService {
  const leaseMs = deps.leaseMs ?? 30_000;
  const leases = new Map<string, LeaseRecord>();
  /** READ locks: múltiplos lessees no mesmo lockId. */
  const readSets = new Map<string, Set<string>>();

  function isExpired(rec: LeaseRecord, now: string): boolean {
    return parseIso(now) > parseIso(rec.endAt);
  }

  function purgeIfExpired(lockId: string, now: string): void {
    const rec = leases.get(lockId);
    if (rec && isExpired(rec, now)) {
      leases.delete(lockId);
      readSets.delete(lockId);
    }
  }

  return {
    acquire(lockId: string, lesseeId: string, lockType: LockType): boolean {
      const now = deps.clock();
      purgeIfExpired(lockId, now);

      const existing = leases.get(lockId);
      if (existing && !isExpired(existing, now)) {
        if (existing.lesseeId === lesseeId) return true;
        if (lockType === 'READ' && existing.lockType === 'READ') {
          let set = readSets.get(lockId);
          if (!set) {
            set = new Set([existing.lesseeId]);
            readSets.set(lockId, set);
          }
          set.add(lesseeId);
          return true;
        }
        return false;
      }

      const rec: LeaseRecord = {
        lesseeId,
        lockId,
        lockType,
        startAt: now,
        endAt: addMs(now, leaseMs),
      };
      leases.set(lockId, rec);
      if (lockType === 'READ') {
        readSets.set(lockId, new Set([lesseeId]));
      }
      return true;
    },

    release(lockId: string, lesseeId: string): boolean {
      const now = deps.clock();
      purgeIfExpired(lockId, now);
      const existing = leases.get(lockId);
      if (!existing) return false;

      const readers = readSets.get(lockId);
      if (existing.lockType === 'READ' && readers) {
        readers.delete(lesseeId);
        if (readers.size === 0) {
          leases.delete(lockId);
          readSets.delete(lockId);
        } else if (existing.lesseeId === lesseeId) {
          // promove outro reader a titular do lease
          const next = readers.values().next().value as string;
          existing.lesseeId = next;
        }
        return true;
      }

      if (existing.lesseeId !== lesseeId) return false;
      leases.delete(lockId);
      readSets.delete(lockId);
      return true;
    },

    refresh(lockId: string, lesseeId: string): boolean {
      const now = deps.clock();
      if (!this.validate(lockId, lesseeId)) return false;
      const rec = leases.get(lockId);
      if (!rec) return false;
      rec.endAt = addMs(now, leaseMs);
      return true;
    },

    validate(lockId: string, lesseeId: string): boolean {
      const now = deps.clock();
      purgeIfExpired(lockId, now);
      const rec = leases.get(lockId);
      if (!rec) return false;
      if (rec.lockType === 'READ') {
        const readers = readSets.get(lockId);
        return readers?.has(lesseeId) === true || rec.lesseeId === lesseeId;
      }
      return rec.lesseeId === lesseeId;
    },

    getLease(lockId: string): LeaseRecord | undefined {
      const now = deps.clock();
      purgeIfExpired(lockId, now);
      const rec = leases.get(lockId);
      return rec ? { ...rec } : undefined;
    },

    cleanupExpired(): string[] {
      const now = deps.clock();
      const removed: string[] = [];
      for (const [id, rec] of leases) {
        if (isExpired(rec, now)) {
          leases.delete(id);
          readSets.delete(id);
          removed.push(id);
        }
      }
      return removed;
    },
  };
}
