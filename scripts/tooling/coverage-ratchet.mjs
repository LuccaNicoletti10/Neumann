/**
 * Coverage ratchet: four metrics, one source of truth, fail-closed.
 *
 * @module
 */

/**
 * @typedef {object} MetricSet
 * @property {number} statements
 * @property {number} branches
 * @property {number} functions
 * @property {number} lines
 */

export const METRIC_KEYS = /** @type {const} */ (['statements', 'branches', 'functions', 'lines']);

/**
 * @typedef {object} CoverageThresholds
 * @property {string} version
 * @property {MetricSet} global
 * @property {Record<string, MetricSet>} packages
 * @property {Array<{ pattern: string, why: string }>} exclusions
 */

/**
 * Floor a measured percentage conservatively (never round up).
 *
 * @param {number} pct
 * @returns {number}
 */
export function floorPct(pct) {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.floor(pct);
}

/**
 * @param {unknown} value
 * @returns {value is MetricSet}
 */
export function isMetricSet(value) {
  if (typeof value !== 'object' || value === null) return false;
  for (const key of METRIC_KEYS) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return false;
  }
  return true;
}

/**
 * Istanbul/Vitest json-summary totals.
 *
 * @param {{ total?: number, covered?: number, pct?: number } | undefined} row
 * @returns {{ total: number, covered: number, pct: number }}
 */
export function readMetricRow(row) {
  const total = Number(row?.total ?? 0);
  const covered = Number(row?.covered ?? 0);
  const pct = Number.isFinite(Number(row?.pct))
    ? Number(row?.pct)
    : total === 0
      ? 100
      : (covered / total) * 100;
  return { total, covered, pct };
}

/**
 * Merge json-summary `total` blocks by summing totals/covered.
 *
 * @param {Array<Record<string, { total?: number, covered?: number, pct?: number }>>} summaries
 * @returns {Record<string, { total: number, covered: number, pct: number }>}
 */
export function mergeSummaryTotals(summaries) {
  const acc = {
    statements: { total: 0, covered: 0, pct: 0 },
    branches: { total: 0, covered: 0, pct: 0 },
    functions: { total: 0, covered: 0, pct: 0 },
    lines: { total: 0, covered: 0, pct: 0 },
  };
  for (const summary of summaries) {
    for (const key of METRIC_KEYS) {
      const row = readMetricRow(summary[key]);
      acc[key].total += row.total;
      acc[key].covered += row.covered;
    }
  }
  for (const key of METRIC_KEYS) {
    const row = acc[key];
    row.pct = row.total === 0 ? 100 : (row.covered / row.total) * 100;
  }
  return acc;
}

/**
 * @param {Record<string, { pct: number }>} totals
 * @returns {MetricSet}
 */
export function totalsToMetrics(totals) {
  return {
    statements: totals.statements.pct,
    branches: totals.branches.pct,
    functions: totals.functions.pct,
    lines: totals.lines.pct,
  };
}

/**
 * @param {MetricSet} actual
 * @param {MetricSet} threshold
 * @param {string} label
 * @returns {string[]}
 */
export function compareMetrics(actual, threshold, label) {
  const problems = [];
  for (const key of METRIC_KEYS) {
    if (actual[key] + 1e-9 < threshold[key]) {
      problems.push(
        `${label} ${key} ${actual[key].toFixed(2)}% < threshold ${threshold[key]}%`,
      );
    }
  }
  return problems;
}

/**
 * @param {unknown} raw
 * @returns {CoverageThresholds}
 */
export function parseThresholds(raw) {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('coverage thresholds: document is not an object');
  }
  if (typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('coverage thresholds: version is required');
  }
  if (!isMetricSet(raw.global)) {
    throw new Error('coverage thresholds: global must include statements/branches/functions/lines');
  }
  if (typeof raw.packages !== 'object' || raw.packages === null) {
    throw new Error('coverage thresholds: packages map is required');
  }
  /** @type {Record<string, MetricSet>} */
  const packages = {};
  for (const [name, value] of Object.entries(raw.packages)) {
    if (!isMetricSet(value)) {
      throw new Error(`coverage thresholds: package ${name} is missing four metrics`);
    }
    packages[name] = value;
  }
  const exclusions = Array.isArray(raw.exclusions) ? raw.exclusions : [];
  for (const item of exclusions) {
    if (typeof item !== 'object' || item === null || typeof item.pattern !== 'string' || typeof item.why !== 'string') {
      throw new Error('coverage thresholds: every exclusion needs pattern and why');
    }
    if (!item.why.startsWith('WHY:')) {
      throw new Error(`coverage thresholds: exclusion ${item.pattern} why must start with WHY:`);
    }
  }
  return {
    version: raw.version,
    global: raw.global,
    packages,
    exclusions,
  };
}

/**
 * @param {object} args
 * @param {CoverageThresholds} args.thresholds
 * @param {MetricSet} args.globalActual
 * @param {Record<string, MetricSet>} args.packageActual
 * @param {string[]} args.packagesWithoutReport
 * @param {string[]} args.packagesWithoutTests
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function evaluateCoverage({
  thresholds,
  globalActual,
  packageActual,
  packagesWithoutReport,
  packagesWithoutTests,
}) {
  const problems = [];
  if (packagesWithoutTests.length > 0) {
    problems.push(`zero tests: ${packagesWithoutTests.join(', ')}`);
  }
  if (packagesWithoutReport.length > 0) {
    problems.push(`missing coverage report: ${packagesWithoutReport.join(', ')}`);
  }
  problems.push(...compareMetrics(globalActual, thresholds.global, 'global'));
  for (const [pkg, threshold] of Object.entries(thresholds.packages)) {
    const actual = packageActual[pkg];
    if (!actual) {
      problems.push(`critical package missing from coverage: ${pkg}`);
      continue;
    }
    problems.push(...compareMetrics(actual, threshold, pkg));
  }
  return { ok: problems.length === 0, problems };
}
