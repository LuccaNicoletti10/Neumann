/**
 * aip-gateway — citations from tool results (ADR-0022).
 */

import type { ObjectCitation } from 'contracts';

export function citationKey(c: ObjectCitation): string {
  return `${c.ontologyId}\0${c.objectTypeId}\0${c.primaryKey}`;
}

export function uniqueCitations(list: ObjectCitation[]): ObjectCitation[] {
  const seen = new Set<string>();
  const out: ObjectCitation[] = [];
  for (const c of list) {
    const k = citationKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Extract citations from structured tool JSON payloads. */
export function citationsFromToolPayload(
  ontologyId: string,
  payload: unknown,
): ObjectCitation[] {
  const found: ObjectCitation[] = [];
  walk(payload);
  return uniqueCitations(found);

  function walk(v: unknown): void {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const objectTypeId = typeof o.objectTypeId === 'string' ? o.objectTypeId : undefined;
    const primaryKey = typeof o.primaryKey === 'string' ? o.primaryKey : undefined;
    if (objectTypeId && primaryKey) {
      found.push({
        ontologyId: typeof o.ontologyId === 'string' ? o.ontologyId : ontologyId,
        objectTypeId,
        primaryKey,
      });
    }
    for (const val of Object.values(o)) walk(val);
  }
}
