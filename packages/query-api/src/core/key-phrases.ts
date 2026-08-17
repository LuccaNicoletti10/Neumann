/**
 * query-api — src/core/key-phrases.ts
 * Caracterização por tokens repetidos no texto autorizado (US 9,619,557).
 * Sem corpus GUI; só propriedades visíveis ao principal.
 */

import type { SearchDocument, SearchPrincipal } from 'contracts';

import { visibleProperties } from './acl.js';
import { contentTokens, stringifyValue } from './tokenize.js';

export function keyPhrases(
  docs: SearchDocument[],
  user: SearchPrincipal,
  limit = 8,
): string[] {
  const freq = new Map<string, number>();
  for (const doc of docs) {
    const props = visibleProperties(doc, user);
    const text = Object.values(props).map(stringifyValue).join(' ');
    const seen = new Set<string>();
    for (const tok of contentTokens(text, true)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tok]) => tok);
}
