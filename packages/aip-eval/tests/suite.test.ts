/**
 * aip-eval — Passo 37 suite + error analysis tests.
 */
import { describe, expect, it } from 'vitest';

import { AIP_ADVERSARIAL_KINDS, assertAipEvalCase } from 'contracts';

import { analyzeEvalFailure } from '../src/core/error-analysis.js';
import { runAipEvalSuite } from '../src/core/runner.js';
import { buildCanonicalAipEvalSuite } from '../src/suite/canonical.js';

describe('canonical AIP eval suite', () => {
  it('covers all 11 adversarials and passes', async () => {
    const cases = buildCanonicalAipEvalSuite();
    for (const c of cases) {
      expect(() => assertAipEvalCase(c)).not.toThrow();
    }
    const covered = new Set(cases.map((c) => c.adversarial).filter(Boolean));
    expect([...covered].sort()).toEqual([...AIP_ADVERSARIAL_KINDS].sort());

    const suite = await runAipEvalSuite({ cases });
    if (!suite.passed) {
      // eslint-disable-next-line no-console
      console.error(
        suite.results
          .filter((r) => !r.passed)
          .map((r) => ({ id: r.caseId, failures: r.failures, answer: r.answer?.slice(0, 120) })),
      );
    }
    expect(suite.adversarialCoverage.missing).toEqual([]);
    expect(suite.passed).toBe(true);
  }, 30_000);
});

describe('error analysis', () => {
  it('never authorizes auto-apply', () => {
    const a = analyzeEvalFailure({
      caseId: 'x',
      failures: ['forbidden action'],
      adversarial: 'prompt_injection',
    });
    expect(a.autoApplyForbidden).toBe(true);
    expect(a.suggestedRemediation.length).toBeGreaterThan(10);
  });
});
