/**
 * cli.ts — linha de comando do Passo 3.
 *
 * Comandos:
 *   serve --port <n>                          sobe a API (usa PASSO03_DATA_DIR ou ./data)
 *   register --email <e> --password <p> [--name <n>] [--admin]
 *   login --email <e> --password <p>          autentica e imprime o token de sessao
 *   create-service-account --name <n>         imprime a API key (exibida 1 unica vez)
 *   metrics                                   snapshot das metricas a partir do log de tentativas
 *
 * Uso: npm run cli -- <comando> [flags]
 */

import { IdentityProvider } from './identity/identity-provider.js';
import { InMemoryPrincipalStore } from './identity/principal-store.js';
import { AuthMetrics } from './auth-monitoring/metrics.js';
import { loadAttemptsFromLog } from './auth-monitoring/login-monitor.js';
import { createApp } from './server/index.js';

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = '', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function dataDir(): string {
  return process.env['PASSO03_DATA_DIR'] ?? './data';
}

function requireString(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`flag obrigatoria ausente: --${key}`);
  }
  return value;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const dir = dataDir();

  switch (command) {
    case 'serve': {
      const port = Number(flags['port'] ?? process.env['PORT'] ?? 3000);
      const { app } = createApp({ dataDir: dir, logger: true });
      await app.listen({ port, host: '0.0.0.0' });
      console.log(`servidor ouvindo em http://0.0.0.0:${port} (dataDir=${dir})`);
      break;
    }
    case 'register': {
      const store = new InMemoryPrincipalStore({ filePath: `${dir}/principals.json` });
      const provider = new IdentityProvider(store);
      const principal = provider.registerUser({
        name: typeof flags['name'] === 'string' ? flags['name'] : requireString(flags, 'email'),
        email: requireString(flags, 'email'),
        password: requireString(flags, 'password'),
        roles: flags['admin'] === true ? ['admin'] : [],
      });
      console.log(JSON.stringify({ id: principal.id, email: principal.email, roles: principal.roles }, null, 2));
      break;
    }
    case 'login': {
      const store = new InMemoryPrincipalStore({ filePath: `${dir}/principals.json` });
      const provider = new IdentityProvider(store);
      const result = provider.authenticate(
        { kind: 'password', email: requireString(flags, 'email'), password: requireString(flags, 'password') },
        { ip: 'cli:local', userAgent: 'passo03-cli' },
      );
      if (!result.ok) {
        console.error(`falha de autenticacao: ${result.reason}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ token: result.session.token, expiresAt: result.session.expiresAt }, null, 2));
      break;
    }
    case 'create-service-account': {
      const store = new InMemoryPrincipalStore({ filePath: `${dir}/principals.json` });
      const provider = new IdentityProvider(store);
      const { principal, apiKey } = provider.createServiceAccount({
        name: requireString(flags, 'name'),
        roles: typeof flags['roles'] === 'string' ? flags['roles'].split(',') : [],
      });
      console.log(JSON.stringify({ id: principal.id, name: principal.name, apiKey }, null, 2));
      break;
    }
    case 'metrics': {
      const metrics = new AuthMetrics();
      for (const attempt of loadAttemptsFromLog(`${dir}/attempts.jsonl`)) {
        metrics.recordAttempt(attempt);
        if (attempt.flaggedAsBreach) metrics.recordBreach(attempt.userId, attempt.ip);
      }
      console.log(JSON.stringify(metrics.snapshot(), null, 2));
      break;
    }
    default:
      console.error(
        'comandos: serve --port <n> | register --email <e> --password <p> [--name <n>] [--admin] | ' +
          'login --email <e> --password <p> | create-service-account --name <n> | metrics',
      );
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
