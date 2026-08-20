/**
 * aip-eval — LLM-assisted error analysis of failed eval traces (ADR-0024).
 * Explains failure + suggests human remediation. Never auto-applies code patches.
 */

export interface EvalFailureTrace {
  caseId: string;
  failures: string[];
  answer?: string;
  toolsUsed?: string[];
  adversarial?: string;
  notes?: string;
}

export interface EvalFailureAnalysis {
  explanation: string;
  suggestedRemediation: string;
  citations: string[];
  autoApplyForbidden: true;
}

export function analyzeEvalFailure(trace: EvalFailureTrace): EvalFailureAnalysis {
  const failures = trace.failures.length
    ? trace.failures.join('; ')
    : 'unspecified failure';
  const adv = trace.adversarial ? ` Adversarial class: ${trace.adversarial}.` : '';
  const tools = trace.toolsUsed?.length
    ? ` Tools used: ${trace.toolsUsed.join(', ')}.`
    : '';

  const explanation =
    `Eval case ${trace.caseId} failed: ${failures}.${adv}${tools}` +
    (trace.answer ? ` Last answer excerpt: ${trace.answer.slice(0, 200)}` : '');

  let suggestedRemediation =
    'Review prompt/tool allow-list, output filter, and ActionExecutor policy. ' +
    'Do not auto-apply LLM patches to production code.';

  if (trace.adversarial === 'exfiltration') {
    suggestedRemediation =
      'Tighten filterAipOutput forbiddenSubstrings / secret redaction; never echo tool payloads with secrets.';
  } else if (trace.adversarial === 'unauthorized_tool') {
    suggestedRemediation =
      'Enforce state.allowedTools before invoke; reject propose tools outside PROPOSE_ACTION.';
  } else if (trace.adversarial === 'model_outage') {
    suggestedRemediation =
      'Ensure LLM failures map to FAILED/ask outage answer with zero Action apply calls.';
  } else if (trace.adversarial === 'action_duplication') {
    suggestedRemediation =
      'Require idempotencyKey on propose_action and rely on ActionExecutor replay semantics.';
  } else if (trace.adversarial === 'infinite_loop') {
    suggestedRemediation =
      'Keep state maxIterations + outer guard; never let MockLlm tool loops run unbounded.';
  }

  return {
    explanation,
    suggestedRemediation,
    citations: [
      'ADR-0024',
      'ADR-0022',
      'ADR-0023',
      ...(trace.adversarial ? [`adversarial:${trace.adversarial}`] : []),
    ],
    autoApplyForbidden: true,
  };
}
