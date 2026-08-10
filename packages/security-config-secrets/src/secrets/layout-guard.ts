/**
 * Passo 3 / SOPS+age (separacao CODE/CONFIG/SECRETS/POLICY):
 * RepoLayoutGuard — enforce da separacao das quatro areas do repo
 * (code/, config/, secrets/, policy/). `scan(rootDir)` detecta violacoes:
 * padroes de secret (chaves privadas, tokens, password=...) fora de
 * secrets/, arquivos .enc fora de secrets/, arquivos de config dentro de
 * code/. `assertClean()` lanca erro — usavel como gate no CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type ViolationKind =
  | 'secret-outside-secrets'
  | 'enc-outside-secrets'
  | 'config-inside-code';

export interface Violation {
  kind: ViolationKind;
  file: string; // path relativo ao root
  detail: string;
  line?: number;
}

export interface ScanReport {
  root: string;
  scannedFiles: number;
  violations: Violation[];
  clean: boolean;
}

const SECRET_PATTERNS: Array<{ re: RegExp; detail: string }> = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, detail: 'chave privada PEM' },
  { re: /\bpassword\s*[:=]\s*['"]?\S+/i, detail: 'password= em texto claro' },
  { re: /\bapi[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i, detail: 'api_key em texto claro' },
  { re: /\btoken\s*[:=]\s*['"]?[A-Za-z0-9_\-.]{16,}/i, detail: 'token em texto claro' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, detail: 'AWS access key id' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/, detail: 'GitHub personal access token' },
  { re: /AGE-SECRET-KEY-1[0-9A-Z]+/, detail: 'chave secreta age-like' },
];

const CONFIG_FILE_RE = /(?:^|[./])[^/]*\.config\.(json|js|ts)$|\.ya?ml$|\.properties$|^\.env(\..+)?$/;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

export class RepoLayoutGuard {
  scan(rootDir: string): ScanReport {
    const violations: Violation[] = [];
    let scanned = 0;

    const walk = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!st.isFile()) continue;
        scanned++;
        const rel = relative(rootDir, full).split('\\').join('/');
        const top = rel.split('/')[0] ?? '';

        // Arquivos cifrados so podem viver em secrets/.
        if (entry.endsWith('.enc') && top !== 'secrets') {
          violations.push({
            kind: 'enc-outside-secrets',
            file: rel,
            detail: 'arquivo .enc fora de secrets/',
          });
        }
        // Arquivos de config nao podem viver em code/.
        if (top === 'code' && CONFIG_FILE_RE.test(entry)) {
          violations.push({
            kind: 'config-inside-code',
            file: rel,
            detail: 'arquivo de configuracao dentro de code/',
          });
        }
        // Padroes de secret fora de secrets/ (arquivos pequenos e texto).
        if (top !== 'secrets' && st.size <= 1024 * 1024) {
          let text: string;
          try {
            text = readFileSync(full, 'utf8');
          } catch {
            continue; // binario/ilegivel
          }
          if (text.includes('�')) continue; // binario
          const lines = text.split('\n');
          lines.forEach((line, i) => {
            for (const { re, detail } of SECRET_PATTERNS) {
              if (re.test(line)) {
                violations.push({ kind: 'secret-outside-secrets', file: rel, detail, line: i + 1 });
                break;
              }
            }
          });
        }
      }
    };

    walk(rootDir);
    return { root: rootDir, scannedFiles: scanned, violations, clean: violations.length === 0 };
  }

  /** Lanca erro listando violacoes (usavel como gate no CI). */
  assertClean(rootDir: string): void {
    const report = this.scan(rootDir);
    if (!report.clean) {
      const lines = report.violations.map(
        (v) => `  [${v.kind}] ${v.file}${v.line ? `:${v.line}` : ''} — ${v.detail}`,
      );
      throw new Error(
        `violacoes de separacao CODE/CONFIG/SECRETS/POLICY (${report.violations.length}):\n` +
          lines.join('\n'),
      );
    }
  }
}