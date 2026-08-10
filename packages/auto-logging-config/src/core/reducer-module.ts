/**
 * ReducerModule — reduz o numero de padroes antes de configurar o daemon.
 */

import { SearchPattern } from "./types";

export interface ReductionReport {
  removedByThreshold: string[];
  merged: Array<{ kept: string; absorbed: string; similarity: number }>;
}

function staticTokens(pattern: SearchPattern): Set<string> {
  const joined = pattern.staticParts.join(" ").toLowerCase();
  return new Set(joined.split(/[^\p{L}\p{N}_]+/u).filter((t) => t.length > 0));
}

export function jaccardSimilarity(a: SearchPattern, b: SearchPattern): number {
  const ta = staticTokens(a);
  const tb = staticTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergePatterns(base: SearchPattern, other: SearchPattern): SearchPattern {
  const otherStatics = new Set(other.staticParts);
  const common = base.staticParts.filter((s) => otherStatics.has(s));
  const params: SearchPattern["params"] = [];
  let regex = "^";
  let gap = 0;
  const addGap = (): void => {
    regex += `(?<g${gap}>.*?)`;
    params.push({ name: `g${gap++}`, type: "any" });
  };
  addGap();
  for (const part of common) {
    regex += escapeRegex(part);
    addGap();
  }
  regex += "$";
  return {
    id: base.id,
    source: base.source,
    regex,
    staticParts: common,
    params,
    matchCount: base.matchCount + other.matchCount,
  };
}

export class ReducerModule {
  applyThreshold(patterns: SearchPattern[], threshold: number): string[] {
    if (threshold < 0) throw new Error("threshold deve ser >= 0");
    if (patterns.length <= threshold) return [];
    const sorted = [...patterns]
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => b.p.matchCount - a.p.matchCount || a.idx - b.idx)
      .map((x) => x.p);
    const removed = sorted.slice(threshold).map((p) => p.id);
    patterns.length = 0;
    patterns.push(...sorted.slice(0, threshold));
    return removed;
  }

  mergeSimilar(
    patterns: SearchPattern[],
    similarityThreshold: number
  ): Array<{ kept: string; absorbed: string; similarity: number }> {
    if (similarityThreshold < 0 || similarityThreshold > 1) {
      throw new Error("similarityThreshold deve estar em [0, 1]");
    }
    const merged: Array<{ kept: string; absorbed: string; similarity: number }> = [];
    const result: SearchPattern[] = [];
    for (const candidate of patterns) {
      let bestIdx = -1;
      let bestSim = 0;
      for (let i = 0; i < result.length; i++) {
        const sim = jaccardSimilarity(result[i]!, candidate);
        if (sim >= similarityThreshold && sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const combined = mergePatterns(result[bestIdx]!, candidate);
        merged.push({ kept: result[bestIdx]!.id, absorbed: candidate.id, similarity: bestSim });
        result[bestIdx] = combined;
      } else {
        result.push(candidate);
      }
    }
    patterns.length = 0;
    patterns.push(...result);
    return merged;
  }

  reduce(
    patterns: SearchPattern[],
    threshold: number,
    similarityThreshold: number
  ): ReductionReport {
    const removedByThreshold = this.applyThreshold(patterns, threshold);
    const merged = this.mergeSimilar(patterns, similarityThreshold);
    return { removedByThreshold, merged };
  }
}
