#!/usr/bin/env node
/**
 * gate:certification — empty-schema PostgreSQL proofs for Prompt 12.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  console.error('gate:certification requires DATABASE_URL');
  process.exit(1);
}

const requirePg = spawnSync('pnpm', ['exec', 'tsx', join(repoRoot, 'scripts/pg-require.ts')], {
  cwd: repoRoot,
  env: process.env,
  encoding: 'utf8',
});
process.stdout.write(requirePg.stdout);
process.stderr.write(requirePg.stderr);
if ((requirePg.status ?? 1) !== 0) {
  process.exit(requirePg.status ?? 1);
}

const files = [
  'tests/prompt12-certification.integration.test.ts',
  'tests/prompt12-readseq.integration.test.ts',
  'tests/assert-production-config.test.ts',
  'tests/ontology-evolution.integration.test.ts',
  'tests/prompt11-function-runtime.integration.test.ts',
];

const result = spawnSync(
  'pnpm',
  [
    '--filter',
    'platform-api',
    'exec',
    'vitest',
    'run',
    ...files,
    '--pool=forks',
    '--fileParallelism=false',
  ],
  { cwd: repoRoot, env: process.env, encoding: 'utf8' },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

const outbox = spawnSync(
  'pnpm',
  [
    '--filter',
    'event-bus',
    'exec',
    'vitest',
    'run',
    'tests/outbox-dispatcher.contract.integration.test.ts',
    'tests/outbox-reliability.integration.test.ts',
  ],
  { cwd: repoRoot, env: process.env, encoding: 'utf8' },
);
process.stdout.write(outbox.stdout);
process.stderr.write(outbox.stderr);

if ((result.status ?? 1) !== 0 || (outbox.status ?? 1) !== 0) {
  console.error('gate:certification failed');
  process.exit(1);
}
console.log('gate:certification ok');
