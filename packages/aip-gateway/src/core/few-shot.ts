/**
 * aip-gateway — few-shot example pick (US20260127387 / ADR-0023).
 * Deterministic hash vectors + centroid pick. No sklearn / no network.
 */

import { createHash } from 'node:crypto';

export interface FewShotExample {
  id: string;
  input: string;
  output: string;
}

/** Pseudo-embedding from SHA-256 chunks — stable across processes. */
export function hashEmbed(text: string, dims = 32): number[] {
  const out: number[] = [];
  let seed = text;
  while (out.length < dims) {
    const dig = createHash('sha256').update(seed).digest();
    for (let i = 0; i < dig.length && out.length < dims; i++) {
      out.push(((dig[i] ?? 0) / 255) * 2 - 1);
    }
    seed = dig.toString('hex');
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/**
 * Pick up to k examples closest to the user input embedding, then one
 * representative per coarse bucket (hash of nearest seed) — patent-shaped
 * without KMeans dependency.
 */
export function selectIdealExamples(
  examples: readonly FewShotExample[],
  userInput: string,
  k = 3,
): FewShotExample[] {
  if (examples.length === 0 || k <= 0) return [];
  const user = hashEmbed(userInput);
  const ranked = examples
    .map((ex) => ({
      ex,
      sim: cosine(user, hashEmbed(`${ex.input}\n${ex.output}`)),
    }))
    .sort((a, b) => b.sim - a.sim);
  const pool = ranked.slice(0, Math.min(ranked.length, Math.max(k * 4, k)));
  const buckets = new Map<number, FewShotExample>();
  for (const row of pool) {
    const bucket = Math.floor((row.sim + 1) * 50) % Math.max(k, 1);
    if (!buckets.has(bucket)) buckets.set(bucket, row.ex);
    if (buckets.size >= k) break;
  }
  const picked = [...buckets.values()];
  if (picked.length >= k) return picked.slice(0, k);
  for (const row of ranked) {
    if (picked.some((p) => p.id === row.ex.id)) continue;
    picked.push(row.ex);
    if (picked.length >= k) break;
  }
  return picked;
}

export function formatFewShotBlock(examples: readonly FewShotExample[]): string {
  if (examples.length === 0) return '';
  const lines = ['Few-shot examples:'];
  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i]!;
    lines.push(`Example ${i + 1}:`);
    lines.push(`Input: ${ex.input}`);
    lines.push(`Output: ${ex.output}`);
  }
  return lines.join('\n');
}
