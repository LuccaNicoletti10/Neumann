#!/usr/bin/env node
/**
 * Local compose helper: default DATABASE_URL to the published host port, then migrate.
 * Application code still consumes only DATABASE_URL.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
if (!env.DATABASE_URL) {
  const port = env.NEUMANN_POSTGRES_PORT || '55432';
  env.DATABASE_URL = `postgres://neumann:neumann@127.0.0.1:${port}/neumann`;
  console.log(`dev:up using DATABASE_URL host port ${port}`);
}

const result = spawnSync('pnpm', ['db:migrate'], { cwd: repoRoot, env, encoding: 'utf8' });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status === null ? 1 : result.status);
