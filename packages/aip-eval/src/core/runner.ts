/**
 * aip-eval — suite runner (Passo 37 / ADR-0024).
 */

import type { AipEvalCase, AipEvalSuiteResult } from 'contracts';
import { AIP_ADVERSARIAL_KINDS } from 'contracts';

import { analyzeEvalFailure } from './error-analysis.js';
import { runEvalCase } from './harness.js';
import {
  AIP_EVAL_SUITE_ID,
  AIP_EVAL_SUITE_VERSION,
  buildCanonicalAipEvalSuite,
} from '../suite/canonical.js';

export interface RunSuiteOptions {
  cases?: AipEvalCase[];
  suiteId?: string;
  suiteVersion?: string;
}

export async function runAipEvalSuite(
  opts: RunSuiteOptions = {},
): Promise<AipEvalSuiteResult> {
  const cases = opts.cases ?? buildCanonicalAipEvalSuite();
  const results = [];
  for (const c of cases) {
    results.push(await runEvalCase(c));
  }

  const covered = [
    ...new Set(
      results
        .map((r) => r.adversarial)
        .filter((a): a is NonNullable<typeof a> => a != null),
    ),
  ];
  const missing = AIP_ADVERSARIAL_KINDS.filter((k) => !covered.includes(k));
  const passed = results.every((r) => r.passed) && missing.length === 0;

  return {
    suiteId: opts.suiteId ?? AIP_EVAL_SUITE_ID,
    suiteVersion: opts.suiteVersion ?? AIP_EVAL_SUITE_VERSION,
    passed,
    results,
    adversarialCoverage: {
      required: AIP_ADVERSARIAL_KINDS,
      covered,
      missing: [...missing],
    },
  };
}

export function explainSuiteFailures(suite: AipEvalSuiteResult) {
  return suite.results
    .filter((r) => !r.passed)
    .map((r) =>
      analyzeEvalFailure({
        caseId: r.caseId,
        failures: r.failures,
        answer: r.answer,
        toolsUsed: r.toolsUsed,
        adversarial: r.adversarial,
      }),
    );
}
