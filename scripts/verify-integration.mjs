#!/usr/bin/env node
/**
 * Mandatory PostgreSQL integration: discover *.integration.test.ts from the
 * single partition module. Hardcoded file lists are forbidden.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertDisjointPartition,
  discoverTestPartition,
  groupByPackage,
} from './test-discovery.mjs';
import { runVitestFiles } from './run-vitest-files.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  console.error('verify:integration requires DATABASE_URL (this is not a skip)');
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
  console.error('verify:integration: PostgreSQL connection or configuration failed (not a skip)');
  process.exit(requirePg.status ?? 1);
}

const partition = discoverTestPartition(repoRoot);
assertDisjointPartition(partition);

if (partition.integrationCount === 0) {
  console.error('verify:integration: zero integration files discovered');
  process.exit(1);
}

console.log(`verify:integration — discovered ${partition.integrationCount} files`);
for (const f of partition.integration) console.log(`  ${f}`);
console.log(
  JSON.stringify(
    {
      total: partition.total,
      unit: partition.unitCount,
      integration: partition.integrationCount,
      unclassified: partition.unclassifiedCount,
      intersection: partition.intersectionCount,
    },
    null,
    2,
  ),
);

const build = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build'], {
  cwd: repoRoot,
  env: process.env,
  encoding: 'utf8',
});
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
if (build.status !== 0) {
  console.error('verify:integration: build failed');
  process.exit(build.status === null ? 1 : build.status);
}

const groups = groupByPackage(repoRoot, partition.integration);
const packageSummaries = [];
let failed = false;
let passed = 0;
let testFailed = 0;
let skipped = 0;
let filesRun = 0;

for (const group of groups) {
  console.log(`\n=== ${group.pkgRel} ===`);
  const ran = await runVitestFiles({ cwd: group.pkgDir, files: group.files, mode: 'integration' });
  if (ran.summary) {
    passed += ran.summary.passed;
    testFailed += ran.summary.failed;
    skipped += ran.summary.skipped.length + ran.summary.pending;
    filesRun += ran.summary.collectedFiles.length;
  }
  packageSummaries.push({
    package: group.pkgRel,
    files: group.files,
    ok: ran.ok,
    error: ran.error,
    passed: ran.summary?.passed ?? 0,
    failed: ran.summary?.failed ?? 0,
    skipped: (ran.summary?.skipped.length ?? 0) + (ran.summary?.pending ?? 0),
    exit: ran.exit,
  });
  if (!ran.ok) {
    failed = true;
    if (ran.error) console.error(`verify:integration ${group.pkgRel}: ${ran.error}`);
  }
}

const report = {
  totalFiles: partition.total,
  unitFiles: partition.unitCount,
  integrationFiles: partition.integrationCount,
  unclassified: partition.unclassified,
  intersection: partition.intersection,
  collectedFiles: filesRun,
  passed,
  failed: testFailed,
  skipped,
  packages: packageSummaries,
};

console.log('\n--- verify:integration summary ---');
console.log(JSON.stringify(report, null, 2));

if (filesRun !== partition.integrationCount) {
  console.error(
    `verify:integration: collected ${filesRun} files, discovered ${partition.integrationCount}`,
  );
  process.exit(1);
}
if (passed + testFailed === 0) {
  console.error('verify:integration: zero tests collected');
  process.exit(1);
}
if (skipped > 0) {
  console.error('verify:integration: skipped tests are an error');
  process.exit(1);
}
process.exit(failed || testFailed > 0 ? 1 : 0);
