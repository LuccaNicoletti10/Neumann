#!/usr/bin/env node
/**
 * Fail-closed static tooling: catalog protocol, tsconfig graph, ESLint.
 *
 * Zero warnings. Unused eslint-disable is an error. Tooling unit tests run
 * first so a broken gate cannot be shipped as a green lint.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyTsconfigGraph } from './tooling/tsconfig-graph.mjs';
import { verifyStorageKernel } from './tooling/storage-kernel.mjs';
import { divergentResolvedVersions, verifyCatalogProtocol } from './tooling/workspace-versions.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(label, command, args) {
  console.log(`\n======== ${label} ========`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`verify:lint stopped at ${label} (exit ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }
}

run('tooling tests', process.execPath, [
  '--test',
  join(repoRoot, 'scripts/tooling/tsconfig-graph.test.mjs'),
  join(repoRoot, 'scripts/tooling/coverage-ratchet.test.mjs'),
  join(repoRoot, 'scripts/tooling/storage-kernel.test.mjs'),
]);

const catalog = verifyCatalogProtocol(repoRoot);
if (!catalog.ok) {
  if (catalog.missingCatalogProtocol.length > 0) {
    console.error('catalog: protocol missing:\n' + catalog.missingCatalogProtocol.join('\n'));
  }
  if (catalog.missingCoverageProvider.length > 0) {
    console.error('missing @vitest/coverage-v8:\n' + catalog.missingCoverageProvider.join('\n'));
  }
  process.exit(1);
}

const list = spawnSync(
  'pnpm',
  ['list', '-r', '--depth', '0', '--json', 'typescript', 'vitest', 'fastify', '@types/node', '@vitest/coverage-v8'],
  { cwd: repoRoot, encoding: 'utf8' },
);
if ((list.status ?? 1) !== 0) {
  console.error('pnpm list -r failed');
  process.stdout.write(list.stdout);
  process.stderr.write(list.stderr);
  process.exit(list.status ?? 1);
}
let parsedList;
try {
  parsedList = JSON.parse(list.stdout);
} catch {
  console.error('pnpm list -r did not emit JSON');
  process.exit(1);
}
const divergent = divergentResolvedVersions(parsedList);
if (divergent.length > 0) {
  console.error('resolved version drift:\n' + divergent.join('\n'));
  process.exit(1);
}

const graph = verifyTsconfigGraph(repoRoot);
if (!graph.ok) {
  if (graph.errors.length > 0) console.error('tsconfig errors:\n' + graph.errors.join('\n'));
  if (graph.disconnected.length > 0) {
    console.error('disconnected tsconfigs:\n' + graph.disconnected.join('\n'));
  }
  if (graph.duplicates.length > 0) {
    console.error(
      'duplicated compilerOptions:\n' +
        graph.duplicates.map((d) => `${d.file}: ${d.keys.join(', ')}`).join('\n'),
    );
  }
  process.exit(1);
}

const storage = verifyStorageKernel(repoRoot);
if (!storage.ok) {
  console.error('storage kernel:\n' + storage.errors.join('\n'));
  process.exit(1);
}

run('eslint', 'pnpm', ['exec', 'eslint', '.', '--max-warnings', '0']);
console.log('\nverify:lint ok');
