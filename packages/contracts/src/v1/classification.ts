/**
 * contracts — src/v1/classification.ts
 * Classification hierarchy + dissemination + lineage inheritance (Passo 26).
 *
 * US 10,146,960 / US 11,720,713 — same object graph, per-principal viewing level.
 * US 10,915,542 — sharing constraint = max(classification) of both ends.
 * Kernel: ordered ranks; higher rank = more restrictive. No map GUI, no anonymous links.
 */

/** Canonical level names used by the kernel hierarchy. */
export type ClassificationName = 'Unclassified' | 'Confidential' | 'Secret' | 'Top Secret';

/** A level in a hierarchical classification scheme. */
export interface ClassificationLevel {
  name: string;
  /** Higher = more restrictive. */
  rank: number;
}

export const UNCLASSIFIED: ClassificationLevel = { name: 'Unclassified', rank: 0 };
export const CONFIDENTIAL: ClassificationLevel = { name: 'Confidential', rank: 10 };
export const SECRET: ClassificationLevel = { name: 'Secret', rank: 20 };
export const TOP_SECRET: ClassificationLevel = { name: 'Top Secret', rank: 30 };

export const DEFAULT_CLASSIFICATION_HIERARCHY: readonly ClassificationLevel[] = [
  UNCLASSIFIED,
  CONFIDENTIAL,
  SECRET,
  TOP_SECRET,
];

const POLICY_TAG_PREFIX = 'classification:';

export function classificationByName(
  name: string,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel | undefined {
  const needle = name.trim().toLowerCase();
  return hierarchy.find((l) => l.name.toLowerCase() === needle);
}

export function resolveClassification(
  value: string | ClassificationLevel | undefined | null,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  if (!value) return hierarchy[0] ?? UNCLASSIFIED;
  if (typeof value !== 'string') {
    const named = classificationByName(value.name, hierarchy);
    return named ?? value;
  }
  return classificationByName(value, hierarchy) ?? hierarchy[0] ?? UNCLASSIFIED;
}

/** Most restrictive of the given markings (empty → Unclassified). */
export function maxClassification(
  values: readonly (string | ClassificationLevel | undefined | null)[],
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  let best = hierarchy[0] ?? UNCLASSIFIED;
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const level = resolveClassification(v, hierarchy);
    if (level.rank > best.rank) best = level;
  }
  return best;
}

/** Least restrictive of the given markings (empty → Unclassified). */
export function minClassification(
  values: readonly (string | ClassificationLevel | undefined | null)[],
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  const named = values
    .filter((v) => v !== undefined && v !== null)
    .map((v) => resolveClassification(v, hierarchy));
  if (named.length === 0) return hierarchy[0] ?? UNCLASSIFIED;
  let best = named[0]!;
  for (const level of named.slice(1)) {
    if (level.rank < best.rank) best = level;
  }
  return best;
}

/**
 * Common viewing level of several principals (US 9,501,761):
 * intersection of clearances = min(effective viewing levels).
 */
export function commonViewingLevel(
  principals: readonly ClassificationPrincipal[],
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  if (principals.length === 0) return hierarchy[0] ?? UNCLASSIFIED;
  return minClassification(
    principals.map((p) => effectiveViewingLevel(p, hierarchy)),
    hierarchy,
  );
}

/** True iff object marking is at or below the viewing level. */
export function canViewAtLevel(
  objectClass: string | ClassificationLevel | undefined,
  viewingLevel: string | ClassificationLevel,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): boolean {
  const obj = resolveClassification(objectClass, hierarchy);
  const view = resolveClassification(viewingLevel, hierarchy);
  return obj.rank <= view.rank;
}

export interface ClassificationPrincipal {
  id: string;
  maxClassification: string;
  /** Temporary downgrade; must not exceed maxClassification. */
  viewingLevel?: string;
}

export function effectiveViewingLevel(
  principal: ClassificationPrincipal,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  const max = resolveClassification(principal.maxClassification, hierarchy);
  if (!principal.viewingLevel) return max;
  const view = resolveClassification(principal.viewingLevel, hierarchy);
  return view.rank <= max.rank ? view : max;
}

/** Asset visible in a dissemination view. */
export interface ClassifiedItem {
  id: string;
  classification?: string;
  sourceSystem?: string;
}

/** Same graph, filtered to markings ≤ viewing level (US 10,146,960). */
export interface DisseminationView<T extends ClassifiedItem = ClassifiedItem> {
  viewingLevel: string;
  banner: string;
  items: T[];
}

export function disseminationView<T extends ClassifiedItem>(
  items: readonly T[],
  viewingLevel: string | ClassificationLevel,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): DisseminationView<T> {
  const view = resolveClassification(viewingLevel, hierarchy);
  return {
    viewingLevel: view.name,
    banner: view.name,
    items: items.filter((item) => canViewAtLevel(item.classification, view, hierarchy)),
  };
}

/**
 * Derived dataset / transform output inherits the max of its inputs.
 * A confidential → transform(A) inherits Confidential.
 */
export function inheritClassification(
  inputClassifications: readonly (string | ClassificationLevel | undefined | null)[],
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  return maxClassification(inputClassifications, hierarchy);
}

/**
 * Cross-source share/link constraint (US 10,915,542): both ends must satisfy
 * the more restrictive marking.
 */
export function sharingConstraint(
  a: string | ClassificationLevel | undefined,
  b: string | ClassificationLevel | undefined,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  return maxClassification([a, b], hierarchy);
}

export function classificationPolicyTag(level: string | ClassificationLevel): string {
  const name = typeof level === 'string' ? level : level.name;
  return `${POLICY_TAG_PREFIX}${name}`;
}

/** Read a marking from CanonicalEvent.policy_tags (or a bare hierarchy name). */
export function classificationFromPolicyTags(
  tags: readonly string[] | undefined,
  hierarchy: readonly ClassificationLevel[] = DEFAULT_CLASSIFICATION_HIERARCHY,
): ClassificationLevel {
  if (!tags?.length) return hierarchy[0] ?? UNCLASSIFIED;
  const found: ClassificationLevel[] = [];
  for (const tag of tags) {
    const raw = tag.startsWith(POLICY_TAG_PREFIX) ? tag.slice(POLICY_TAG_PREFIX.length) : tag;
    const level = classificationByName(raw, hierarchy);
    if (level) found.push(level);
  }
  return maxClassification(found, hierarchy);
}

export function assertClassificationLevel(level: ClassificationLevel): void {
  if (!level.name) throw new Error('ClassificationLevel: name obrigatório');
  if (!Number.isFinite(level.rank) || level.rank < 0) {
    throw new Error('ClassificationLevel: rank inválido');
  }
}
