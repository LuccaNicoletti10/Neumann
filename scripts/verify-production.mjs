#!/usr/bin/env node
/**
 * verify:production — fail-closed production configuration (ADR-0021).
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync(
  'pnpm',
  [
    '--filter',
    'platform-api',
    'exec',
    'vitest',
    'run',
    'tests/assert-production-config.test.ts',
    'tests/production-authz.test.ts',
    'tests/auth.test.ts',
  ],
  { cwd: repoRoot, env: process.env, encoding: 'utf8' },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if ((result.status ?? 1) !== 0) {
  console.error('verify:production failed');
  process.exit(result.status ?? 1);
}
console.log('verify:production ok');
