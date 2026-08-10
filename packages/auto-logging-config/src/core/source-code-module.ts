/**
 * SourceCodeModule — componente da patente que examina o codigo-fonte de
 * pacotes de software e identifica call expressions que sao chamadas de logging.
 */

import * as fs from "fs";
import * as path from "path";
import { LoggingCallExpression } from "./types";

/** Assinaturas de funcoes de logging reconhecidas pelo scanner. */
export type LoggingSignatureSet = string[];

/** Conjunto padrao de assinaturas (Go, JS/TS e Python). */
export const DEFAULT_SIGNATURES: LoggingSignatureSet = [
  "log.Printf",
  "log.Println",
  "log.Fatal",
  "log.Fatalf",
  "plog.Warningf",
  "plog.Infof",
  "logrus.Infof",
  "logrus.Errorf",
  "fmt.Printf",
  "fmt.Sprintf",
  "console.log",
  "console.error",
  "console.warn",
  "logger.info",
  "logger.warn",
  "logger.error",
  "logger.debug",
  "logging.info",
  "logging.warning",
];

const SUPPORTED_EXTENSIONS = new Set([".go", ".ts", ".js", ".py"]);

/** Escapa uma string para uso literal em regex. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Detecta o nome da funcao que envolve uma linha de codigo (heuristica multi-linguagem). */
function detectEnclosingFunction(line: string): string | null {
  const patterns: RegExp[] = [
    /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
    /\bfunction\s+([A-Za-z_]\w*)\s*\(/,
    /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/,
    /\b(?:async\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/,
    /\bdef\s+([A-Za-z_]\w*)\s*\(/,
  ];
  for (const re of patterns) {
    const m = re.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/** Remove o delimitador de uma string literal e retorna seu conteudo bruto. */
function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const q = trimmed[0];
    if ((q === '"' || q === "'" || q === "`") && trimmed[trimmed.length - 1] === q) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Extrai os argumentos de uma chamada iniciada em `openIdx` (indice do '('),
 * respeitando strings e aninhamento de parenteses/colchetes/chaves.
 */
export function extractArguments(
  text: string,
  openIdx: number
): { args: string[]; endIdx: number } | null {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  let i = openIdx;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < text.length) current += text[++i]!;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth > 1) current += ch;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        if (current.trim().length > 0) args.push(current.trim());
        return { args, endIdx: i + 1 };
      }
      current += ch;
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  return null;
}

/**
 * Examina o conteudo de um arquivo-fonte e retorna as chamadas de logging
 * correspondentes ao conjunto de assinaturas configurado.
 */
export function scanSource(
  filePath: string,
  content: string,
  signatures: LoggingSignatureSet = DEFAULT_SIGNATURES
): LoggingCallExpression[] {
  const results: LoggingCallExpression[] = [];
  const sortedSigs = [...signatures].sort((a, b) => b.length - a.length);
  const sigAlt = sortedSigs.map(escapeRegex).join("|");
  if (!sigAlt) return results;
  const callRe = new RegExp(`(?<![\\w.])(${sigAlt})\\s*\\(`, "g");

  const lines = content.split(/\r?\n/);
  const functionByLine: string[] = new Array(lines.length).fill("<module>");
  let currentFn = "<module>";
  for (let li = 0; li < lines.length; li++) {
    const fn = detectEnclosingFunction(lines[li]!);
    if (fn) currentFn = fn;
    functionByLine[li] = currentFn;
  }

  let m: RegExpExecArray | null;
  while ((m = callRe.exec(content)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const extracted = extractArguments(content, openIdx);
    if (!extracted) continue;
    callRe.lastIndex = extracted.endIdx;
    const line = content.slice(0, m.index).split(/\r?\n/).length;
    const first = extracted.args[0] ?? "";
    const firstTrim = first.trim();
    const isStringLiteral =
      firstTrim.length >= 2 &&
      (firstTrim[0] === '"' || firstTrim[0] === "'" || firstTrim[0] === "`") &&
      firstTrim[firstTrim.length - 1] === firstTrim[0];
    results.push({
      file: filePath,
      line,
      function: functionByLine[line - 1] ?? "<module>",
      formatString: isStringLiteral ? unquote(firstTrim) : "",
      argCount: extracted.args.length,
    });
  }
  return results;
}

/** Repositorio de codigo-fonte: scanning recursivo de diretorio. */
export class SourceCodeRepository {
  constructor(
    public readonly rootDir: string,
    private readonly signatures: LoggingSignatureSet = DEFAULT_SIGNATURES
  ) {}

  private collectFiles(dir: string, out: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.collectFiles(full, out);
      } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }

  /** Examina recursivamente o repositorio e retorna todas as chamadas de logging. */
  scan(): LoggingCallExpression[] {
    const files: string[] = [];
    this.collectFiles(this.rootDir, files);
    const calls: LoggingCallExpression[] = [];
    for (const file of files.sort()) {
      const content = fs.readFileSync(file, "utf8");
      calls.push(...scanSource(file, content, this.signatures));
    }
    return calls;
  }
}
