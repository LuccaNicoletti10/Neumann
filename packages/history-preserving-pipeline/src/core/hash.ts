/**
 * history-preserving-pipeline — src/core/hash.ts
 * sha256 canônico de payloads (chaves ordenadas).
 */

import { createHash } from 'node:crypto';

/** Serializa valor com chaves ordenadas recursivamente. */
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

/** sha256 hex do JSON canônico. */
export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}

/** sha256 hex de bytes brutos. */
export function hashBytes(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** contentRef = path content-addressed. */
export function contentRefFor(hash: string): string {
  return `sha256/${hash}`;
}
