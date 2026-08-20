/**
 * aip-eval — public surface (Passo 37 / ADR-0024).
 */

export {
  scoreEvalCase,
  type ObservedEvalRun,
} from './core/metrics.js';
export { analyzeEvalFailure, type EvalFailureTrace, type EvalFailureAnalysis } from './core/error-analysis.js';
export { runEvalCase } from './core/harness.js';
export { runAipEvalSuite, explainSuiteFailures, type RunSuiteOptions } from './core/runner.js';
export {
  buildCanonicalAipEvalSuite,
  AIP_EVAL_SUITE_ID,
  AIP_EVAL_SUITE_VERSION,
  AIP_AGENT_VERSION,
  AIP_PROMPT_VERSION,
  AIP_MODEL_VERSION,
} from './suite/canonical.js';
