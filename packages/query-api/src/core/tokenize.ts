/**
 * query-api — src/core/tokenize.ts
 */

const STOP = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'with', 'on', 'at', 'from', 'by',
  'in', 'as', 'is', 'and', 'or', 'but', 'um', 'uma', 'de', 'da', 'do', 'e',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function contentTokens(text: string, dropStop = false): string[] {
  const toks = tokenize(text);
  return dropStop ? toks.filter((t) => !STOP.has(t) && t.length > 1) : toks;
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(stringifyValue).join(' ');
  return '';
}
