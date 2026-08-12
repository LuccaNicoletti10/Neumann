/**
 * execution-sandbox — src/core/policy.ts
 */

import { buildGoldenSandboxPolicy, type SandboxPolicy } from 'contracts';

export function resolvePolicy(partial?: Partial<SandboxPolicy>): SandboxPolicy {
  return { ...buildGoldenSandboxPolicy(), ...partial };
}

export function isPathAllowed(path: string, allowPrefixes: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  if (allowPrefixes.length === 0) return false;
  return allowPrefixes.some((raw) => {
    const p = raw.endsWith('/') ? raw : `${raw}/`;
    const bare = raw.replace(/\/$/, '');
    return normalized === bare || normalized.startsWith(p);
  });
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}
