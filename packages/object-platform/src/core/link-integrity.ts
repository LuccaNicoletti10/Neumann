/**
 * object-platform — src/core/link-integrity.ts
 * Shared cardinality + endpoint checks (memory + Postgres).
 */

export type LinkCardinality = '1:1' | '1:N' | 'N:1' | 'N:N';

/** Schema cardinality wins over client hint. */
export function resolveCardinality(
  schemaCardinality?: string,
  clientCardinality?: string,
): LinkCardinality | undefined {
  const raw = schemaCardinality ?? clientCardinality;
  if (raw === '1:1' || raw === '1:N' || raw === 'N:1' || raw === 'N:N') return raw;
  return undefined;
}

/**
 * 1:1 — at most one edge from source AND at most one into target.
 * 1:N — many from source; at most one into a given target.
 * N:1 — at most one from a given source; many into target.
 * N:N — free.
 */
export function cardinalityViolation(
  cardinality: LinkCardinality | undefined,
  existingFromSource: boolean,
  existingIntoTarget: boolean,
): string | undefined {
  if (!cardinality || cardinality === 'N:N') return undefined;
  if ((cardinality === '1:1' || cardinality === 'N:1') && existingFromSource) {
    return `cardinality ${cardinality} violated for source`;
  }
  if ((cardinality === '1:1' || cardinality === '1:N') && existingIntoTarget) {
    return `cardinality ${cardinality} violated on target`;
  }
  return undefined;
}

/** Deterministic advisory-lock keys: from-endpoint then to-endpoint. */
export function cardinalityLockKeys(input: {
  ontologyId: string;
  linkTypeId: string;
  sourceObjectTypeId: string;
  sourcePrimaryKey: string;
  targetObjectTypeId: string;
  targetPrimaryKey: string;
}): { fromKey: string; toKey: string; scopeKey: string } {
  const scopeKey = `${input.ontologyId}\u001f${input.linkTypeId}`;
  return {
    fromKey: `${scopeKey}\u001ffrom\u001f${input.sourceObjectTypeId}\u001f${input.sourcePrimaryKey}`,
    toKey: `${scopeKey}\u001fto\u001f${input.targetObjectTypeId}\u001f${input.targetPrimaryKey}`,
    scopeKey,
  };
}
