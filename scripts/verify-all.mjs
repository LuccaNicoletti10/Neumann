#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const steps = [
  'verify:lint',
  'verify:typecheck',
  'verify:unit',
  'verify:coverage',
  'verify:migrations:fresh',
  'verify:integration',
  'verify:build',
];

for (const step of steps) {
  console.log(`\n======== ${step} ========`);
  const result = spawnSync('pnpm', ['run', step], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if ((result.status ?? 1) !== 0) {
    console.error(`verify:all stopped at ${step} (exit ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nverify:all ok');
