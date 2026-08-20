#!/usr/bin/env node
/**
 * Unit verification: structurally UNIT only, no PostgreSQL, zero skips.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertDisjointPartition,
  discoverTestPartition,
  groupByPackage,
} from './test-discovery.mjs';
import { runPool, runVitestFiles } from './run-vitest-files.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

delete process.env.DATABASE_URL;

const partition = discoverTestPartition(repoRoot);
assertDisjointPartition(partition);

if (partition.unitCount === 0) {
  console.error('verify:unit: zero unit test files discovered');
  process.exit(1);
}

console.log('verify:unit — DATABASE_URL unset; integration files excluded');
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

const groups = groupByPackage(repoRoot, partition.unit);
const ran = await runPool(groups, 2, async (group) => {
  console.log(`\n=== ${group.pkgRel} (${group.files.length} files) ===`);
  const result = await runVitestFiles({ cwd: group.pkgDir, files: group.files, mode: 'unit' });
  if (!result.ok && result.error) {
    console.error(`verify:unit ${group.pkgRel}: ${result.error}`);
  }
  return { group, result };
});

let failed = false;
let passed = 0;
let testFailed = 0;
let skipped = 0;
let filesRun = 0;
const packageSummaries = [];

for (const { group, result } of ran) {
  if (result.summary) {
    passed += result.summary.passed;
    testFailed += result.summary.failed;
    skipped += result.summary.skipped.length + result.summary.pending;
    filesRun += result.summary.collectedFiles.length;
  }
  packageSummaries.push({
    package: group.pkgRel,
    files: group.files.length,
    ok: result.ok,
    error: result.error,
    passed: result.summary?.passed ?? 0,
    failed: result.summary?.failed ?? 0,
    skipped: (result.summary?.skipped.length ?? 0) + (result.summary?.pending ?? 0),
  });
  if (!result.ok) failed = true;
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

console.log('\n--- verify:unit summary ---');
console.log(JSON.stringify(report, null, 2));

if (filesRun === 0 || passed + testFailed === 0) {
  console.error('verify:unit: zero tests collected');
  process.exit(1);
}
if (skipped > 0) {
  console.error('verify:unit: skipped tests are an error');
  process.exit(1);
}
process.exit(failed || testFailed > 0 ? 1 : 0);
