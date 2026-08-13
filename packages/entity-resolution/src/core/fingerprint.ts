/**
 * entity-resolution — src/core/fingerprint.ts
 * Copy-detection fingerprints for entity text (US 12,393,406 / US20250348288A1).
 * k-grams → hash → sliding windows → winnow (min hash, rightmost on ties)
 * → blacklist boilerplate → coalesce/rank by adjacent matches.
 *
 * Applied to normalized entity fields, not source code. No domain types.
 */

import type { EntityFingerprintPoint, EntityRecord, FingerprintMatch } from 'contracts';

import { normalizeRecord } from './normalize.js';

export const DEFAULT_K = 5;
export const DEFAULT_WINDOW = 4;
/** Adjacent / near-adjacent k-gram gap used when coalescing (claim 13). */
export const ADJACENT_GAP = 3;

/** Generic legal-form / boilerplate snippets — not identity-bearing. */
export const DEFAULT_BLACKLIST_SNIPPETS: readonly string[] = [
  'ltda',
  'limitada',
  'comercio',
  'comercial',
  'company',
  'incorporated',
  'gmbh',
  'llc',
  'inc',
  ' sa',
  ' me',
  ' epp',
];

export function recordSnippet(record: EntityRecord): string {
  const n = normalizeRecord(record);
  const parts = [
    n.fields.name,
    n.fields.document,
    n.fields.email,
    n.fields.phone,
    n.fields.city,
  ].filter((v): v is string => Boolean(v));
  return parts.join(' ').trim();
}

export function generateKGrams(text: string, k: number = DEFAULT_K): string[] {
  if (k < 1) throw new Error('k must be >= 1');
  if (!text) return [];
  if (text.length < k) return [text];
  const grams: string[] = [];
  for (let i = 0; i <= text.length - k; i++) grams.push(text.slice(i, i + k));
  return grams;
}

/** Deterministic 32-bit djb2. */
export function hashKGram(gram: string): number {
  let h = 5381;
  for (let i = 0; i < gram.length; i++) {
    h = ((h << 5) + h + gram.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function slidingWindows(hashes: number[], windowSize: number): number[][] {
  if (windowSize < 1) throw new Error('windowSize must be >= 1');
  if (hashes.length === 0) return [];
  if (hashes.length < windowSize) return [hashes.slice()];
  const out: number[][] = [];
  for (let i = 0; i <= hashes.length - windowSize; i++) {
    out.push(hashes.slice(i, i + windowSize));
  }
  return out;
}

/**
 * Winnow: min hash in each window; ties → right-most in that window.
 * Returns unique (hash, global position) pairs.
 */
export function winnow(hashes: number[], windowSize: number = DEFAULT_WINDOW): EntityFingerprintPoint[] {
  if (hashes.length === 0) return [];
  if (hashes.length < windowSize) {
    return hashes.map((hash, position) => ({ hash, position }));
  }
  const chosen: EntityFingerprintPoint[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= hashes.length - windowSize; i++) {
    const win = hashes.slice(i, i + windowSize);
    let minVal = win[0]!;
    let rightmost = 0;
    for (let j = 1; j < win.length; j++) {
      const v = win[j]!;
      if (v < minVal || v === minVal) {
        minVal = v;
        rightmost = j;
      }
    }
    const position = i + rightmost;
    const hash = hashes[position]!;
    const key = `${hash}:${position}`;
    if (!seen.has(key)) {
      seen.add(key);
      chosen.push({ hash, position });
    }
  }
  return chosen;
}

export function fingerprintText(
  text: string,
  k: number = DEFAULT_K,
  windowSize: number = DEFAULT_WINDOW,
): EntityFingerprintPoint[] {
  const grams = generateKGrams(text, k);
  const hashes = grams.map(hashKGram);
  return winnow(hashes, windowSize);
}

export function fingerprintRecord(
  record: EntityRecord,
  k: number = DEFAULT_K,
  windowSize: number = DEFAULT_WINDOW,
): EntityFingerprintPoint[] {
  return fingerprintText(recordSnippet(record), k, windowSize);
}

export function blacklistHashes(
  snippets: readonly string[] = DEFAULT_BLACKLIST_SNIPPETS,
  k: number = DEFAULT_K,
  windowSize: number = DEFAULT_WINDOW,
): Set<number> {
  const out = new Set<number>();
  for (const s of snippets) {
    for (const p of fingerprintText(s.trim().toLowerCase(), k, windowSize)) {
      out.add(p.hash);
    }
  }
  return out;
}

export function stripBlacklisted(
  points: EntityFingerprintPoint[],
  banned: Set<number>,
): EntityFingerprintPoint[] {
  return points.filter((p) => !banned.has(p.hash));
}

export interface IndexedFingerprint {
  recordId: string;
  objectTypeId: string;
  points: EntityFingerprintPoint[];
}

/** Coalesce fingerprint hits per record and rank by adjacent k-gram density. */
export function coalesceMatches(
  hits: Array<{ recordId: string; position: number }>,
): FingerprintMatch[] {
  const groups = new Map<string, number[]>();
  for (const h of hits) {
    const list = groups.get(h.recordId) ?? [];
    list.push(h.position);
    groups.set(h.recordId, list);
  }
  const ranked: FingerprintMatch[] = [];
  for (const [recordId, positions] of groups) {
    positions.sort((a, b) => a - b);
    let score = positions.length > 0 ? 1 : 0;
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i]! - positions[i - 1]!;
      if (gap <= ADJACENT_GAP) score += 2;
      else score += 1 / (gap + 1);
    }
    ranked.push({ recordId, score, positions });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.recordId.localeCompare(b.recordId);
  });
  return ranked;
}

export function lookupFingerprintHits(
  query: EntityFingerprintPoint[],
  index: IndexedFingerprint[],
  banned: Set<number>,
  queryRecordId?: string,
): FingerprintMatch[] {
  const q = stripBlacklisted(query, banned);
  if (q.length === 0) return [];
  const qHashes = new Set(q.map((p) => p.hash));
  const hits: Array<{ recordId: string; position: number }> = [];
  for (const rec of index) {
    if (queryRecordId && rec.recordId === queryRecordId) continue;
    for (const p of rec.points) {
      if (banned.has(p.hash)) continue;
      if (qHashes.has(p.hash)) hits.push({ recordId: rec.recordId, position: p.position });
    }
  }
  return coalesceMatches(hits);
}
