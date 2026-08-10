#!/usr/bin/env node
/**
 * Passo 3 / EP4660856 + US20250298632A1 + SOPS+age:
 * CLI unico da plataforma:
 *   scan-deps --lockfile <path> --db <advisories.json> [--fail-on high]
 *   report   --lockfile <path> --db <advisories.json> [--format text|json]
 *   suppress --advisory X --package Y --reason "..." --expires 30d --by user
 *   env gui <name> | env set <name> <path> <value> | env history <name>
 *   secrets keygen | secrets set <env> <key> | secrets get <env> <key>
 *   guard <rootDir>
 *   serve --port 3000
 * O gate do CI e o scan-deps: sai com exit code 1 quando a politica falha.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DependencyInventory } from './security/dependency-inventory.js';
import { AdvisoryDatabase, severityLevels, type Severity } from './security/advisory-db.js';
import { VulnerabilityScanner } from './security/scanner.js';
import { PolicyGate, securityPolicySchema } from './security/policy-gate.js';
import { SuppressionStore } from './security/suppressions.js';
import { SecurityReport } from './security/report.js';
import { ConfigServer } from './env-config/config-service.js';
import { ChangeComputer, type ScalarValue } from './env-config/change-computer.js';
import { GuiGenerator } from './env-config/gui-generator.js';
import { AgeLikeCrypto } from './secrets/age-crypto.js';
import { SecretsManager } from './secrets/secrets-manager.js';
import { RepoLayoutGuard } from './secrets/layout-guard.js';
import { startServer } from './server/index.js';

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flagStr(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

function requireFlag(args: ParsedArgs, name: string): string {
  const v = flagStr(args, name);
  if (v === undefined) throw new Error(`flag obrigatoria ausente: --${name}`);
  return v;
}

/** Converte "30d", "12h", "2026-01-01" em data de expiracao. */
export function parseExpiry(spec: string, now: Date = new Date()): Date {
  const rel = /^(\d+)\s*([dhm])$/.exec(spec.trim());
  if (rel) {
    const n = Number.parseInt(rel[1]!, 10);
    const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000 }[rel[2] as 'd' | 'h' | 'm'];
    return new Date(now.getTime() + n * unitMs);
  }
  const d = new Date(spec);
  if (Number.isNaN(d.getTime())) throw new Error(`expiracao invalida: "${spec}" (use 30d, 12h, 60m ou ISO)`);
  return d;
}

function scanPipeline(args: ParsedArgs): {
  findings: ReturnType<VulnerabilityScanner['scan']>;
  gate: PolicyGate;
} {
  const lockfile = requireFlag(args, 'lockfile');
  const dbPath = requireFlag(args, 'db');
  const failOn = flagStr(args, 'fail-on') ?? 'high';
  if (!(severityLevels as readonly string[]).includes(failOn)) {
    throw new Error(`--fail-on invalido: ${failOn} (use ${severityLevels.join('|')})`);
  }
  const inventory = DependencyInventory.fromLockfile(lockfile);
  const db = AdvisoryDatabase.fromFile(dbPath);
  const scanner = new VulnerabilityScanner(db);
  const findings = scanner.scan(inventory);
  const suppressionsPath = flagStr(args, 'suppressions');
  const suppressions = suppressionsPath
    ? new SuppressionStore(suppressionsPath, suppressionsPath + '.audit.jsonl')
    : undefined;
  const policy = securityPolicySchema.parse({
    failOnSeverity: failOn as Severity,
    ...(flagStr(args, 'max-findings') !== undefined
      ? { maxFindings: Number(flagStr(args, 'max-findings')) }
      : {}),
  });
  const gate = new PolicyGate(policy, suppressions);
  return { findings, gate };
}

function ageKeyFromEnv(): string {
  const key = process.env['AGE_SECRET_KEY'];
  if (!key) throw new Error('defina AGE_SECRET_KEY com a chave secreta age-like');
  return key;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseScalarValue(raw: string): ScalarValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const root = resolve(flagStr(args, 'root') ?? '.');

  switch (cmd) {
    case 'scan-deps': {
      const { findings, gate } = scanPipeline(args);
      const result = gate.evaluate(findings);
      const report = new SecurityReport(findings, result);
      console.log(report.toText());
      return result.decision === 'pass' ? 0 : 1; // gate do CI
    }

    case 'report': {
      const { findings, gate } = scanPipeline(args);
      const result = gate.evaluate(findings);
      const report = new SecurityReport(findings, result);
      const format = flagStr(args, 'format') ?? 'text';
      console.log(format === 'json' ? report.toJsonString() : report.toText());
      return 0;
    }

    case 'suppress': {
      const file = requireFlag(args, 'suppressions');
      const store = new SuppressionStore(file, file + '.audit.jsonl');
      const by = requireFlag(args, 'by');
      const sup = store.add(
        {
          advisoryId: requireFlag(args, 'advisory'),
          packageName: requireFlag(args, 'package'),
          reason: requireFlag(args, 'reason'),
          expiresAt: parseExpiry(requireFlag(args, 'expires')).toISOString(),
          approvedBy: by,
        },
        by,
      );
      console.log(`supressao registrada: ${sup.advisoryId} em ${sup.packageName} (expira ${sup.expiresAt})`);
      return 0;
    }

    case 'env': {
      const [sub, name] = args.positional;
      const configs = new ConfigServer(root);
      if (sub === 'gui' && name) {
        const { indexed } = configs.getConfig(name);
        const html = new GuiGenerator().generate(indexed, name);
        const out = flagStr(args, 'out');
        if (out) {
          writeFileSync(out, html, 'utf8');
          console.log(`GUI escrita em ${out}`);
        } else {
          console.log(html);
        }
        return 0;
      }
      if (sub === 'set' && name) {
        const [path, rawValue] = args.positional.slice(2);
        if (!path || rawValue === undefined) throw new Error('uso: env set <name> <path> <value>');
        const { indexed, version } = configs.getConfig(name);
        const instruction = new ChangeComputer().compute(indexed, path, parseScalarValue(rawValue));
        const applied = configs.apply(name, [instruction], version, 'cli');
        console.log(`aplicado: ${path} -> ${instruction.insertText} (versao ${applied.version})`);
        return 0;
      }
      if (sub === 'history' && name) {
        for (const v of configs.history(name)) {
          console.log(`v${v.version}  ${v.appliedAt}  ${v.author}  (${v.instructions.length} instrucoes)`);
        }
        return 0;
      }
      throw new Error('uso: env gui|set|history ...');
    }

    case 'secrets': {
      const [sub] = args.positional;
      if (sub === 'keygen') {
        const kp = AgeLikeCrypto.generateKeyPair();
        console.log(`public: ${kp.publicKey}`);
        console.log(`secret: ${kp.secretKey}  # guarde fora do repo (AGE_SECRET_KEY)`);
        return 0;
      }
      const manager = new SecretsManager(root, ageKeyFromEnv(), []);
      if (sub === 'set') {
        const [env, key] = args.positional.slice(1);
        if (!env || !key) throw new Error('uso: secrets set <env> <key> [--value v | stdin]');
        const value = flagStr(args, 'value') ?? (await readStdin());
        manager.set(env, key, value.replace(/\n$/, ''));
        console.log(`secret gravado (cifrado): ${env}/${key}`);
        return 0;
      }
      if (sub === 'get') {
        const [env, key] = args.positional.slice(1);
        if (!env || !key) throw new Error('uso: secrets get <env> <key>');
        console.log(manager.get(env, key));
        return 0;
      }
      if (sub === 'list-keys') {
        const [env] = args.positional.slice(1);
        if (!env) throw new Error('uso: secrets list-keys <env>');
        for (const k of manager.listKeys(env)) console.log(k);
        return 0;
      }
      throw new Error('uso: secrets keygen|set|get|list-keys ...');
    }

    case 'guard': {
      const target = args.positional[0] ?? root;
      const guard = new RepoLayoutGuard();
      const report = guard.scan(resolve(target));
      console.log(`arquivos varridos: ${report.scannedFiles}`);
      if (report.clean) {
        console.log('layout limpo: separacao CODE/CONFIG/SECRETS/POLICY respeitada');
        return 0;
      }
      for (const v of report.violations) {
        console.error(`[${v.kind}] ${v.file}${v.line ? `:${v.line}` : ''} — ${v.detail}`);
      }
      return 1;
    }

    case 'serve': {
      const port = Number(flagStr(args, 'port') ?? '3000');
      await startServer(port, root);
      console.log(`servidor em http://0.0.0.0:${port} (root=${root})`);
      // Mantem o processo vivo ate SIGINT/SIGTERM (nao retorna).
      await new Promise<void>(() => {});
      return 0;
    }

    default:
      console.log(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
      return cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 2;
  }
}

// Executa somente quando chamado como programa (nao em testes de import).
const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(`erro: ${(err as Error).message}`);
      process.exit(2);
    });
}
