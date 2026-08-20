#!/usr/bin/env node
/**
 * Fail-closed unit coverage ratchet.
 *
 * Runs the UNIT partition with V8 coverage, refuses missing reports / zero
 * tests, and compares four metrics against `docs/quality/coverage-thresholds.json`.
 *
 * `--measure` writes the measured floors to stdout and skips the ratchet
 * (used once to establish the baseline from data).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateCoverage,
  floorPct,
  mergeSummaryTotals,
  parseThresholds,
  totalsToMetrics,
} from './tooling/coverage-ratchet.mjs';
import { listWorkspacePackages } from './tooling/workspace-versions.mjs';
import {
  assertDisjointPartition,
  discoverTestPartition,
  groupByPackage,
} from './test-discovery.mjs';
import { runPool, runVitestFiles } from './run-vitest-files.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const measureOnly = process.argv.includes('--measure');
const thresholdsPath = join(repoRoot, 'docs/quality/coverage-thresholds.json');
const coverageRoot = join(repoRoot, 'coverage', 'unit');

const CRITICAL_PACKAGES = [
  'packages/action-engine',
  'packages/connector-sdk',
  'packages/contracts',
  'packages/event-bus',
  'packages/execution-sandbox',
  'packages/knowledge-graph',
  'packages/object-platform',
  'packages/object-set',
  'packages/ontology-registry',
  'packages/platform-api',
  'packages/policy-engine',
];

delete process.env.DATABASE_URL;

const partition = discoverTestPartition(repoRoot);
assertDisjointPartition(partition);
if (partition.unitCount === 0) {
  console.error('verify:coverage: zero unit test files discovered');
  process.exit(1);
}

const packages = listWorkspacePackages(repoRoot).filter((p) => p.path !== '.');
const groups = groupByPackage(repoRoot, partition.unit);
const tested = new Set(groups.map((g) => g.pkgRel));
const packagesWithoutTests = packages
  .map((p) => p.path)
  .filter((p) => !tested.has(p))
  .sort();

rmSync(coverageRoot, { recursive: true, force: true });
mkdirSync(coverageRoot, { recursive: true });

const ran = await runPool(groups, 2, async (group) => {
  const coverageDir = join(coverageRoot, group.pkgRel.replace(/[\\/]/g, '__'));
  console.log(`\n=== coverage ${group.pkgRel} (${group.files.length} files) ===`);
  const result = await runVitestFiles({
    cwd: group.pkgDir,
    files: group.files,
    mode: 'unit',
    coverageDir,
  });
  if (!result.ok && result.error) {
    console.error(`verify:coverage ${group.pkgRel}: ${result.error}`);
  }
  return { group, result, coverageDir };
});

let failed = false;
const summaries = [];
const packageActual = {};
const packagesWithoutReport = [];

for (const { group, result, coverageDir } of ran) {
  if (!result.ok) failed = true;
  const summaryPath = join(coverageDir, 'coverage-summary.json');
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch {
    packagesWithoutReport.push(group.pkgRel);
    continue;
  }
  const total = summary.total;
  if (typeof total !== 'object' || total === null) {
    packagesWithoutReport.push(group.pkgRel);
    continue;
  }
  summaries.push(total);
  packageActual[group.pkgRel] = totalsToMetrics({
    statements: total.statements,
    branches: total.branches,
    functions: total.functions,
    lines: total.lines,
  });
}

if (failed) {
  console.error('verify:coverage: unit tests failed under coverage');
  process.exit(1);
}

const merged = mergeSummaryTotals(summaries);
const globalActual = totalsToMetrics(merged);

const measured = {
  version: '2026-08-18',
  global: {
    statements: floorPct(globalActual.statements),
    branches: floorPct(globalActual.branches),
    functions: floorPct(globalActual.functions),
    lines: floorPct(globalActual.lines),
  },
  packages: Object.fromEntries(
    CRITICAL_PACKAGES.map((pkg) => {
      const actual = packageActual[pkg];
      if (!actual) return [pkg, { statements: 0, branches: 0, functions: 0, lines: 0 }];
      return [
        pkg,
        {
          statements: floorPct(actual.statements),
          branches: floorPct(actual.branches),
          functions: floorPct(actual.functions),
          lines: floorPct(actual.lines),
        },
      ];
    }),
  ),
  measured: {
    global: globalActual,
    packages: Object.fromEntries(
      Object.entries(packageActual).map(([pkg, metrics]) => [
        pkg,
        {
          statements: Number(metrics.statements.toFixed(4)),
          branches: Number(metrics.branches.toFixed(4)),
          functions: Number(metrics.functions.toFixed(4)),
          lines: Number(metrics.lines.toFixed(4)),
        },
      ]),
    ),
  },
};

console.log('\n--- verify:coverage measured ---');
console.log(JSON.stringify(measured, null, 2));

if (measureOnly) {
  writeFileSync(join(coverageRoot, 'measured.json'), JSON.stringify(measured, null, 2));
  console.log('verify:coverage measure-only (no ratchet)');
  process.exit(packagesWithoutTests.length > 0 || packagesWithoutReport.length > 0 ? 1 : 0);
}

let thresholds;
try {
  thresholds = parseThresholds(JSON.parse(readFileSync(thresholdsPath, 'utf8')));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`verify:coverage: cannot read ${thresholdsPath}: ${message}`);
  process.exit(1);
}

const verdict = evaluateCoverage({
  thresholds,
  globalActual,
  packageActual,
  packagesWithoutReport,
  packagesWithoutTests,
});

console.log('\n--- verify:coverage ratchet ---');
console.log(JSON.stringify({ ok: verdict.ok, problems: verdict.problems }, null, 2));
if (!verdict.ok) {
  console.error(verdict.problems.join('\n'));
  process.exit(1);
}
console.log('verify:coverage ok');
