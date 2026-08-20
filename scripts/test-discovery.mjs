/**
 * Single source of truth for test file classification.
 *
 * ALL_TESTS = UNIT ∪ INTEGRATION
 * UNIT ∩ INTEGRATION = ∅
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
export const INTEGRATION_RE = /\.integration\.(test|spec)\.[cm]?[jt]sx?$/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo', 'build']);

export function repoRootFrom(metaUrl) {
  return resolve(dirname(fileURLToPath(metaUrl)), '..');
}

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

export function classifyTestFile(relPath) {
  const base = relPath.split('/').pop() ?? relPath;
  if (INTEGRATION_RE.test(base)) return 'integration';
  if (TEST_FILE_RE.test(base)) return 'unit';
  return 'unclassified';
}

export function discoverTestPartition(root) {
  const roots = [join(root, 'packages'), join(root, 'apps')];
  const allAbs = [];
  for (const dir of roots) walk(dir, allAbs);

  const unit = [];
  const integration = [];
  const unclassified = [];

  for (const abs of allAbs) {
    const rel = relative(root, abs);
    const kind = classifyTestFile(rel);
    if (kind === 'unit') unit.push(rel);
    else if (kind === 'integration') integration.push(rel);
    else if (TEST_FILE_RE.test(rel.split('/').pop() ?? '')) unclassified.push(rel);
  }

  unit.sort();
  integration.sort();
  unclassified.sort();

  const unitSet = new Set(unit);
  const intersection = integration.filter((f) => unitSet.has(f));
  const total = unit.length + integration.length + unclassified.length;

  return {
    total,
    unit,
    integration,
    unclassified,
    intersection,
    unitCount: unit.length,
    integrationCount: integration.length,
    unclassifiedCount: unclassified.length,
    intersectionCount: intersection.length,
  };
}

export function assertDisjointPartition(partition) {
  const errors = [];
  if (partition.intersectionCount !== 0) {
    errors.push(`UNIT ∩ INTEGRATION ≠ ∅: ${partition.intersection.join(', ')}`);
  }
  if (partition.unclassifiedCount !== 0) {
    errors.push(`unclassified test files: ${partition.unclassified.join(', ')}`);
  }
  if (partition.unitCount + partition.integrationCount !== partition.total) {
    errors.push(
      `ALL_TESTS ≠ UNIT ∪ INTEGRATION (total=${partition.total} unit=${partition.unitCount} integration=${partition.integrationCount})`,
    );
  }
  if (errors.length > 0) {
    throw new Error(`test partition violated:\n${errors.join('\n')}`);
  }
}

export function groupByPackage(root, relFiles) {
  const byPackage = new Map();
  for (const rel of relFiles) {
    const parts = rel.split('/');
    if (parts.length < 3) {
      throw new Error(`test file is not under packages/* or apps/*: ${rel}`);
    }
    const pkgRel = join(parts[0], parts[1]);
    const fileInPkg = parts.slice(2).join('/');
    const list = byPackage.get(pkgRel) ?? [];
    list.push(fileInPkg);
    byPackage.set(pkgRel, list);
  }
  return [...byPackage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkgRel, files]) => ({
      pkgRel,
      pkgDir: join(root, pkgRel),
      files: files.sort(),
    }));
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = repoRootFrom(import.meta.url);
  const partition = discoverTestPartition(root);
  assertDisjointPartition(partition);
  console.log(
    JSON.stringify(
      {
        total: partition.total,
        unitCount: partition.unitCount,
        integrationCount: partition.integrationCount,
        unclassifiedCount: partition.unclassifiedCount,
        intersectionCount: partition.intersectionCount,
        unit: partition.unit,
        integration: partition.integration,
      },
      null,
      2,
    ),
  );
}
