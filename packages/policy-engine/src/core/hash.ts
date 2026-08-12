/**
 * policy-engine — src/core/hash.ts
 */

import { createHash } from 'node:crypto';

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}

export function sha256Hex(parts: readonly (string | null | undefined)[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p ?? '');
    h.update('\0');
  }
  return h.digest('hex');
}
