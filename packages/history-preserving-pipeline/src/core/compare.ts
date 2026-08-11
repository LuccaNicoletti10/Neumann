/**
 * history-preserving-pipeline — src/core/compare.ts
 * Diff estrutural + compareVersions sobre payloads serializados.
 */

import type { VersionDiff, VersionId } from 'contracts';

import { canonicalizeJson } from './hash.js';
import type { ManifestStore } from './manifest.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Diff de chaves de topo (objetos) ou igualdade estrutural (arrays/primitivos). */
export function structuralDiff(a: unknown, b: unknown): Pick<
  VersionDiff,
  'addedKeys' | 'removedKeys' | 'changedKeys' | 'sameContent'
> {
  if (canonicalizeJson(a) === canonicalizeJson(b)) {
    return { sameContent: true, addedKeys: [], removedKeys: [], changedKeys: [] };
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return { sameContent: false, addedKeys: [], removedKeys: [], changedKeys: ['$'] };
  }
  const keysA = new Set(Object.keys(a));
  const keysB = new Set(Object.keys(b));
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  const changedKeys: string[] = [];
  for (const k of keysB) {
    if (!keysA.has(k)) addedKeys.push(k);
  }
  for (const k of keysA) {
    if (!keysB.has(k)) removedKeys.push(k);
    else if (canonicalizeJson(a[k]) !== canonicalizeJson(b[k])) changedKeys.push(k);
  }
  addedKeys.sort();
  removedKeys.sort();
  changedKeys.sort();
  return { sameContent: false, addedKeys, removedKeys, changedKeys };
}

export function compareVersions(manifest: ManifestStore, a: VersionId, b: VersionId): VersionDiff {
  const va = manifest.getVersion(a);
  const vb = manifest.getVersion(b);
  if (!va) throw new Error(`versão inexistente: ${a}`);
  if (!vb) throw new Error(`versão inexistente: ${b}`);
  const payloadA = manifest.getPayload(a);
  const payloadB = manifest.getPayload(b);
  const struct =
    payloadA !== undefined && payloadB !== undefined
      ? structuralDiff(payloadA, payloadB)
      : {
          sameContent: va.contentHash === vb.contentHash,
          addedKeys: [] as string[],
          removedKeys: [] as string[],
          changedKeys: va.contentHash === vb.contentHash ? [] : (['$'] as string[]),
        };
  return {
    a,
    b,
    contentHashA: va.contentHash,
    contentHashB: vb.contentHash,
    ...struct,
    sameContent: va.contentHash === vb.contentHash && struct.sameContent,
  };
}
