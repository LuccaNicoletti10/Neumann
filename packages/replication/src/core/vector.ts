/**
 * replication — src/core/vector.ts
 */

import type { VersionCompare, VersionVector } from 'contracts';

export function incrementVector(vv: VersionVector, siteId: string, delta = 1): VersionVector {
  return { ...vv, [siteId]: (vv[siteId] ?? 0) + delta };
}

export function mergeVectors(v1: VersionVector, v2: VersionVector): VersionVector {
  const result: VersionVector = { ...v1 };
  for (const key of Object.keys(v2)) {
    result[key] = Math.max(result[key] ?? 0, v2[key] ?? 0);
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
