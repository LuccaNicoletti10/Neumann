/**
 * offline-sync — src/core/version-vector.ts
 * US 8,515,912 — compare / merge / increment.
 */

import type { ReplicaId, VersionCompare, VersionVector } from 'contracts';

export function incrementVector(vv: VersionVector, replicaId: ReplicaId, delta = 1): VersionVector {
  return { ...vv, [replicaId]: (vv[replicaId] ?? 0) + delta };
}

export function mergeVectors(v1: VersionVector, v2: VersionVector): VersionVector {
  const result: VersionVector = { ...v1 };
  for (const key of Object.keys(v2)) {
    const a = result[key] ?? 0;
    const b = v2[key] ?? 0;
    result[key] = Math.max(a, b);
  }
  return result;
}

export function compareVectors(v1: VersionVector, v2: VersionVector): VersionCompare {
  const keys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
  let v1LeV2 = true;
  let v2LeV1 = true;
  let v1LtV2 = false;
  let v2LtV1 = false;
  for (const key of keys) {
    const a = v1[key] ?? 0;
    const b = v2[key] ?? 0;
    if (a > b) {
      v1LeV2 = false;
      v2LtV1 = true;
    } else if (b > a) {
      v2LeV1 = false;
      v1LtV2 = true;
    }
  }
  if (v1LeV2 && v2LeV1) return 'identical';
  if (v1LeV2 && v1LtV2) return 'ordered';
  if (v2LeV1 && v2LtV1) return 'ordered';
  return 'concurrent';
}

/** true se v1 aconteceu estritamente antes de v2 (v1 < v2). */
export function isOrderedBefore(v1: VersionVector, v2: VersionVector): boolean {
  if (compareVectors(v1, v2) !== 'ordered') return false;
  const keys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
  let hasLess = false;
  for (const key of keys) {
    const a = v1[key] ?? 0;
    const b = v2[key] ?? 0;
    if (a > b) return false;
    if (a < b) hasLess = true;
  }
  return hasLess;
}

export function cloneVector(vv: VersionVector): VersionVector {
  return { ...vv };
}

export function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
