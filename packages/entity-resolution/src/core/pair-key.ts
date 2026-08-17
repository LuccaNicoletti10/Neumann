/**
 * entity-resolution — src/core/pair-key.ts
 * Canonical unordered pair key (left|right sorted).
 */

export function pairKey(leftId: string, rightId: string): string {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

export function sortedPairIds(leftId: string, rightId: string): { leftId: string; rightId: string } {
  return leftId < rightId
    ? { leftId, rightId }
    : { leftId: rightId, rightId: leftId };
}
