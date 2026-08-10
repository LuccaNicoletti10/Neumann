/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * Mini-motor de ranges semver (>=, >, <=, <, =, ||, espacos, versoes exatas,
 * prefixos parciais como "1.2" e curingas "1.x") sem dependencia externa.
 * Usado pelo AdvisoryDatabase para casar pacotes vulneraveis.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

/** Converte "1.2.3-rc.1" em SemVer; prefixos parciais sao completados com 0. */
export function parseVersion(input: string): SemVer | null {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(
    input.trim(),
  );
  if (!m || !m[1]) return null;
  const num = (s: string | undefined): number =>
    s === undefined || s === 'x' || s === '*' ? 0 : Number.parseInt(s, 10);
  return {
    major: Number.parseInt(m[1], 10),
    minor: num(m[2]),
    patch: num(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // Versao sem pre-release e maior que qualquer pre-release.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (an) return -1;
    else if (bn) return 1;
    else if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/** -1 se a < b, 0 se iguais, 1 se a > b. */
export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function eqVersion(a: SemVer, b: SemVer): boolean {
  return compareVersions(a, b) === 0;
}

interface Comparator {
  op: '>=' | '<=' | '>' | '<' | '=';
  version: SemVer;
}

function parseComparator(token: string): Comparator | null {
  const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(token.trim());
  if (!m || !m[2]) return null;
  const version = parseVersion(m[2]);
  if (!version) return null;
  return { op: (m[1] as Comparator['op']) ?? '=', version };
}

function satisfiesComparator(v: SemVer, c: Comparator): boolean {
  const cmp = compareVersions(v, c.version);
  switch (c.op) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>': return cmp > 0;
    case '<': return cmp < 0;
    case '=': return cmp === 0;
  }
}

/**
 * Verifica se `version` satisfaz `range`.
 * Suporta: "1.2.3", ">=1.0.0 <2.0.0", "< 1.4.2 || >= 2.0.0 < 2.1.0", "1.x".
 * Range vazio ou "*" casa tudo.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'x') return true;
  const alternatives = trimmed.split('||').map((s) => s.trim()).filter(Boolean);
  return alternatives.some((alt) => {
    // Junta operador separado por espaco da versao ("< 1.4.2" -> "<1.4.2").
    const rawTokens = alt.split(/\s+/).filter(Boolean);
    const tokens: string[] = [];
    for (const tok of rawTokens) {
      const prev = tokens[tokens.length - 1];
      if (prev !== undefined && /^(>=|<=|>|<|=)$/.test(prev)) {
        tokens[tokens.length - 1] = prev + tok;
      } else {
        tokens.push(tok);
      }
    }
    // Versao exata/curinga solta ("1.2.3" ou "1.x") conta como comparador unico.
    return tokens.every((tok) => {
      if (/^v?\d+(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.test(tok) && /x|\*/.test(tok)) {
        // Curinga: prefixo numerico deve casar.
        const vParts = version.replace(/^v/, '').split('.');
        const tParts = tok.replace(/^v/, '').split('.');
        return tParts.every((p, i) => p === 'x' || p === '*' || vParts[i] === p);
      }
      const comp = parseComparator(tok);
      return comp !== null && satisfiesComparator(v, comp);
    });
  });
}