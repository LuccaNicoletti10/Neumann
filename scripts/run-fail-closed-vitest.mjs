#!/usr/bin/env node
/**
 * Fail-closed Vitest runner: missing URL, zero files, zero tests, or any skip → exit 1.
 * File lists come from test-discovery (no second glob).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).filter((a) => a !== '--' && !a.startsWith('--mode='));

if (files.length === 0) {
  console.error('usage: run-fail-closed-vitest.mjs <file> [file...]');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [join(repoRoot, 'scripts/run-vitest-files.mjs'), '--mode=integration', ...files],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8', stdio: 'inherit' },
);
process.exit(result.status === null ? 1 : result.status);
