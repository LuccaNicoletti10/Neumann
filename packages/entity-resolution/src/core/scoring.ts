/**
 * entity-resolution — src/core/scoring.ts
 * Scoring por regras ponderadas + thresholds (US 9,501,552 / US 12,229,154).
 * Determinístico por rule_version (T3.7).
 */

import type {
  CandidatePair,
  LinkingTerm,
  MatchDecision,
  MatchingTechnique,
  NormalizedFields,
  NormalizedRecord,
  ResolutionCriteria,
  ScoreFeatures,
} from 'contracts';

/** Similaridade de nome: Jaccard sobre tokens (proxy in-memory de pg_trgm). */
export function nameSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  // Bonus Levenshtein-lite para typos curtos no string inteiro
  if (jaccard >= 0.5) return jaccard;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  const dist = levenshtein(a, b);
  const lev = 1 - dist / maxLen;
  return Math.max(jaccard, lev);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[n] ?? 0;
}

function fieldValue(fields: NormalizedFields, property: string): string | undefined {
  return fields[property];
}

function applyTechnique(
  left: string | undefined,
  right: string | undefined,
  technique: MatchingTechnique,
): number {
  if (technique === 'no_conflicts') {
    if (left == null || right == null) return 1;
    return left === right ? 1 : 0;
  }
  if (left == null || right == null) return 0;
  if (technique === 'exact_match') return left === right ? 1 : 0;
  // fuzzy
  return nameSimilarity(left, right);
}

export function decide(score: number, criteria: ResolutionCriteria): MatchDecision {
  if (score >= criteria.thresholds.match) return 'match';
  if (score < criteria.thresholds.noMatch) return 'no_match';
  return 'review';
}

export function scorePair(
  left: NormalizedRecord,
  right: NormalizedRecord,
  blockKey: string,
  criteria: ResolutionCriteria,
): CandidatePair {
  const propertyScores: Record<string, number> = {};
  let weighted = 0;
  let weightSum = 0;
  const sharedExactKeys: string[] = [];

  for (const term of criteria.linkingTerms) {
    const prop = String(term.property);
    const lv = fieldValue(left.fields, prop);
    const rv = fieldValue(right.fields, prop);
    const s = applyTechnique(lv, rv, term.technique);
    propertyScores[prop] = s;
    // Só conta peso se pelo menos um lado tem valor (evita inflar com ausências)
    if (lv != null || rv != null || term.technique === 'no_conflicts') {
      weighted += s * term.weight;
      weightSum += term.weight;
    }
    if (term.technique === 'exact_match' && s === 1 && lv != null) {
      sharedExactKeys.push(prop);
    }
  }

  const score = weightSum > 0 ? weighted / weightSum : 0;
  const confidence = Math.max(0, Math.min(1, score));
  const decision = decide(score, criteria);

  const features: ScoreFeatures = {
    sharedExactKeys,
    propertyScores,
    nameSimilarity: propertyScores.name,
    documentEqual: propertyScores.document === 1,
    emailEqual: propertyScores.email === 1,
    phoneEqual: propertyScores.phone === 1,
  };

  const reason = buildReason(decision, score, features, criteria.linkingTerms);

  return {
    leftId: left.recordId,
    rightId: right.recordId,
    objectTypeId: left.objectTypeId,
    blockKey,
    score,
    confidence,
    features,
    decision,
    reason,
    ruleVersionId: criteria.ruleVersionId,
  };
}

function buildReason(
  decision: MatchDecision,
  score: number,
  features: ScoreFeatures,
  terms: LinkingTerm[],
): string {
  const parts: string[] = [];
  for (const t of terms) {
    const prop = String(t.property);
    const s = features.propertyScores[prop];
    if (s === undefined) continue;
    if (s > 0) parts.push(`${prop}=${s.toFixed(2)}*${t.weight}`);
  }
  return `${decision} score=${score.toFixed(3)} [${parts.join(', ') || 'no signals'}]`;
}
