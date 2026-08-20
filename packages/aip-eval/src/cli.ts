#!/usr/bin/env node
/**
 * aip-eval CLI — run canonical adversarial suite.
 */

import { explainSuiteFailures, runAipEvalSuite } from './index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: aip-eval [-- suite]\nRuns the Passo 37 canonical AIP eval suite.');
    return;
  }

  const suite = await runAipEvalSuite();
  const failed = suite.results.filter((r) => !r.passed);
  console.log(
    JSON.stringify(
      {
        suiteId: suite.suiteId,
        suiteVersion: suite.suiteVersion,
        passed: suite.passed,
        total: suite.results.length,
        failed: failed.length,
        adversarialCoverage: suite.adversarialCoverage,
        failures: failed.map((r) => ({
          id: r.caseId,
          adversarial: r.adversarial,
          failures: r.failures,
        })),
        analyses: explainSuiteFailures(suite).map((a) => ({
          explanation: a.explanation,
          suggestedRemediation: a.suggestedRemediation,
        })),
      },
      null,
      2,
    ),
  );
  if (!suite.passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
