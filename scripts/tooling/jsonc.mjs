/**
 * Minimal JSONC reader for tsconfig files.
 *
 * Strings are preserved so recursive src globs are not treated as comments.
 *
 * @param {string} text raw file contents
 * @returns {unknown} parsed value
 */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out);
}
