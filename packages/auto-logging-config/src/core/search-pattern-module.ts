/**
 * SearchPatternModule — a partir dos argumentos de cada logging call, constroi
 * um search pattern (regex) que reconhece a mensagem de saida correspondente.
 */

import { LoggingCallExpression, PatternParam, SearchPattern } from "./types";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface FormatToken {
  kind: "static" | "param";
  text?: string;
  name?: string;
  type?: PatternParam["type"];
  body?: string;
}

/**
 * Tokeniza uma format string em porcoes estaticas e especificadores de formato.
 */
export function tokenizeFormatString(format: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf.length > 0) {
      tokens.push({ kind: "static", text: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    if (ch === "%") {
      const m = /^%(?:[-+ 0#]*\d*(?:\.\d+)?)?([sdvqfxeEgGtTw%])/.exec(format.slice(i));
      if (m) {
        const verb = m[1]!;
        const full = m[0];
        if (verb === "%") {
          buf += "%";
        } else {
          flush();
          const isFloat = "feEgG".includes(verb);
          const isInt = verb === "d";
          const isQuoted = verb === "q";
          tokens.push({
            kind: "param",
            type: isFloat || isInt ? "number" : "string",
            body: isQuoted
              ? '"(?:[^"\\\\]|\\\\.)*"'
              : isFloat
                ? "-?\\d+(?:\\.\\d+)?"
                : isInt
                  ? "-?\\d+"
                  : ".+?",
          });
        }
        i += full.length;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === "{") {
      const named = /^\{([A-Za-z_]\w*)\}/.exec(format.slice(i));
      if (named) {
        flush();
        tokens.push({ kind: "param", name: named[1], type: "string", body: ".+?" });
        i += named[0].length;
        continue;
      }
      if (format.startsWith("{}", i)) {
        flush();
        tokens.push({ kind: "param", type: "any", body: ".+?" });
        i += 2;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === "$" && format[i + 1] === "{") {
      const close = format.indexOf("}", i + 2);
      if (close !== -1) {
        flush();
        const expr = format.slice(i + 2, close).trim();
        tokens.push({
          kind: "param",
          name: /^[A-Za-z_]\w*$/.test(expr) ? expr : undefined,
          type: "any",
          body: ".+?",
        });
        i = close + 1;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return tokens;
}

/** Constroi um SearchPattern a partir de uma chamada de logging identificada. */
export function buildSearchPattern(call: LoggingCallExpression, id: string): SearchPattern {
  const tokens = tokenizeFormatString(call.formatString);
  const staticParts: string[] = [];
  const params: PatternParam[] = [];
  const usedNames = new Set<string>();
  let regex = "";
  let anon = 0;
  for (const token of tokens) {
    if (token.kind === "static") {
      staticParts.push(token.text ?? "");
      regex += escapeRegex(token.text ?? "");
      continue;
    }
    let name = token.name ?? `p${anon++}`;
    while (usedNames.has(name)) name = `${name}_${anon++}`;
    usedNames.add(name);
    params.push({ name, type: token.type ?? "any" });
    regex += `(?<${name}>${token.body ?? ".+?"})`;
  }
  return {
    id,
    source: { file: call.file, line: call.line, function: call.function },
    regex: `^${regex}$`,
    staticParts,
    params,
    matchCount: 0,
  };
}

/**
 * Lista ordenada de padroes por matchCount decrescente.
 */
export class OrderedPatternList {
  private patterns: SearchPattern[] = [];

  add(pattern: SearchPattern): void {
    this.patterns.push(pattern);
    this.sort();
  }

  setAll(patterns: SearchPattern[]): void {
    this.patterns = [...patterns];
    this.sort();
  }

  sort(): void {
    this.patterns = this.patterns
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => b.p.matchCount - a.p.matchCount || a.idx - b.idx)
      .map((x) => x.p);
  }

  get size(): number {
    return this.patterns.length;
  }

  getAll(): SearchPattern[] {
    return [...this.patterns];
  }

  match(message: string): { pattern: SearchPattern; params: Record<string, string> } | null {
    for (const pattern of this.patterns) {
      const m = new RegExp(pattern.regex).exec(message);
      if (m) {
        pattern.matchCount++;
        this.sort();
        return { pattern, params: { ...(m.groups ?? {}) } };
      }
    }
    return null;
  }
}
