import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareMetrics,
  evaluateCoverage,
  floorPct,
  mergeSummaryTotals,
  parseThresholds,
} from './coverage-ratchet.mjs';
import { findDepSpec } from './workspace-versions.mjs';

describe('coverage-ratchet', () => {
  it('floors percentages and never rounds up', () => {
    assert.equal(floorPct(67.9), 67);
    assert.equal(floorPct(0), 0);
    assert.equal(floorPct(-1), 0);
  });

  it('fails when any of the four metrics drops below threshold', () => {
    const problems = compareMetrics(
      { statements: 50, branches: 40, functions: 45, lines: 49.9 },
      { statements: 50, branches: 40, functions: 45, lines: 50 },
      'global',
    );
    assert.deepEqual(problems, ['global lines 49.90% < threshold 50%']);
  });

  it('merges package summaries by summing covered/total', () => {
    const merged = mergeSummaryTotals([
      {
        statements: { total: 10, covered: 8 },
        branches: { total: 4, covered: 2 },
        functions: { total: 2, covered: 2 },
        lines: { total: 10, covered: 8 },
      },
      {
        statements: { total: 10, covered: 2 },
        branches: { total: 6, covered: 3 },
        functions: { total: 2, covered: 0 },
        lines: { total: 10, covered: 2 },
      },
    ]);
    assert.equal(merged.statements.total, 20);
    assert.equal(merged.statements.covered, 10);
    assert.equal(merged.statements.pct, 50);
    assert.equal(merged.functions.pct, 50);
  });

  it('fails closed on missing report, zero tests, and hidden critical package', () => {
    const thresholds = parseThresholds({
      version: '2026-08-18',
      global: { statements: 10, branches: 10, functions: 10, lines: 10 },
      packages: {
        'packages/contracts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
      exclusions: [{ pattern: '**/dist/**', why: 'WHY: generated emit' }],
    });
    const result = evaluateCoverage({
      thresholds,
      globalActual: { statements: 90, branches: 90, functions: 90, lines: 90 },
      packageActual: {},
      packagesWithoutReport: ['packages/object-platform'],
      packagesWithoutTests: ['packages/ghost'],
    });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes('zero tests')));
    assert.ok(result.problems.some((p) => p.includes('missing coverage report')));
    assert.ok(result.problems.some((p) => p.includes('critical package missing')));
  });

  it('rejects exclusions without WHY:', () => {
    assert.throws(
      () =>
        parseThresholds({
          version: 'x',
          global: { statements: 1, branches: 1, functions: 1, lines: 1 },
          packages: {},
          exclusions: [{ pattern: 'src/**', why: 'low coverage' }],
        }),
      /WHY:/,
    );
  });
});

describe('workspace-versions', () => {
  it('requires catalog: when a catalogued dep is present', () => {
    const spec = findDepSpec({ devDependencies: { typescript: '5.5.4' } }, 'typescript');
    assert.deepEqual(spec, { field: 'devDependencies', spec: '5.5.4' });
  });

  it('accepts catalog: protocol', () => {
    const spec = findDepSpec({ devDependencies: { typescript: 'catalog:' } }, 'typescript');
    assert.equal(spec?.spec, 'catalog:');
  });
});
