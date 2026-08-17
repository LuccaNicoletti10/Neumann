/**
 * query-api — src/core/surfaces.ts
 * Seis superfícies: hit, autocomplete, facet, suggestion, snippet, ranking.
 * Todas derivadas só do conjunto já autorizado.
 */

import type {
  SearchDocument,
  SearchFacet,
  SearchHit,
  SearchPrincipal,
  SearchSuggestion,
} from 'contracts';

import { visibleProperties } from './acl.js';
import { stringifyValue, tokenize } from './tokenize.js';

export function snippetOf(
  doc: SearchDocument,
  user: SearchPrincipal,
  q?: string,
): string | undefined {
  const props = visibleProperties(doc, user);
  const parts = Object.values(props).map(stringifyValue).filter(Boolean);
  const blob = parts.join(' ');
  if (!blob) return undefined;
  if (q) {
    const needle = q.toLowerCase();
    const idx = blob.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 16);
      return blob.slice(start, start + 80);
    }
  }
  return blob.slice(0, 80);
}

export function scoreDoc(doc: SearchDocument, user: SearchPrincipal, q?: string): number {
  if (!q || !q.trim()) return 1;
  const props = visibleProperties(doc, user);
  const hay = Object.values(props).map(stringifyValue).join(' ').toLowerCase();
  const pk = doc.primaryKey.toLowerCase();
  let score = 0;
  for (const tok of tokenize(q)) {
    if (pk === tok) score += 5;
    else if (pk.includes(tok)) score += 3;
    if (hay.includes(tok)) score += 1;
  }
  return score;
}

export function toHit(
  doc: SearchDocument,
  user: SearchPrincipal,
  q?: string,
): SearchHit {
  return {
    id: doc.id,
    objectTypeId: String(doc.objectTypeId),
    primaryKey: doc.primaryKey,
    properties: visibleProperties(doc, user),
    score: scoreDoc(doc, user, q),
    snippet: snippetOf(doc, user, q),
  };
}

export function buildFacets(
  docs: SearchDocument[],
  user: SearchPrincipal,
  fields: string[],
): SearchFacet[] {
  const out: SearchFacet[] = [];
  for (const field of fields) {
    const counts = new Map<string, number>();
    for (const doc of docs) {
      const props = visibleProperties(doc, user);
      const raw = props[field];
      if (raw === undefined || raw === null) continue;
      const val = stringifyValue(raw);
      if (!val) continue;
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    out.push({
      field,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    });
  }
  return out;
}

export function buildAutocomplete(
  docs: SearchDocument[],
  user: SearchPrincipal,
  q?: string,
  limit = 8,
): SearchSuggestion[] {
  const prefix = (q ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: SearchSuggestion[] = [];
  for (const doc of docs) {
    const props = visibleProperties(doc, user);
    const labels = [doc.primaryKey, stringifyValue(props['name'])].filter(Boolean);
    for (const label of labels) {
      const lower = label.toLowerCase();
      if (prefix && !lower.startsWith(prefix) && !lower.includes(prefix)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push({ text: label, kind: 'object', score: prefix && lower.startsWith(prefix) ? 2 : 1 });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function buildSuggestions(
  hits: SearchHit[],
  limit = 5,
): SearchSuggestion[] {
  return hits.slice(0, limit).map((h) => ({
    text: stringifyValue(h.properties['name']) || h.primaryKey,
    kind: 'object' as const,
    score: h.score,
  }));
}

export function rankHits(hits: SearchHit[], limit: number): SearchHit[] {
  return [...hits]
    .sort((a, b) => b.score - a.score || a.primaryKey.localeCompare(b.primaryKey))
    .slice(0, limit);
}
