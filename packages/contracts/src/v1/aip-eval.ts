/**
 * contracts — AIP evaluation framework (Passo 37 / ADR-0024).
 * Versioned eval cases + metrics. Does not authorize mutations.
 */

export type AipAdversarialKind =
  | 'prompt_injection'
  | 'exfiltration'
  | 'unauthorized_tool'
  | 'fake_instructions_in_document'
  | 'poisoned_search'
  | 'stale_context'
  | 'conflicting_facts'
  | 'infinite_loop'
  | 'action_duplication'
  | 'tool_timeout'
  | 'model_outage';

export const AIP_ADVERSARIAL_KINDS: readonly AipAdversarialKind[] = [
  'prompt_injection',
  'exfiltration',
  'unauthorized_tool',
  'fake_instructions_in_document',
  'poisoned_search',
  'stale_context',
  'conflicting_facts',
  'infinite_loop',
  'action_duplication',
  'tool_timeout',
  'model_outage',
] as const;

export type AipEvalMode = 'ask' | 'agent';

export interface AipEvalExpectedAction {
  actionApiName: string;
  parameters?: Record<string, unknown>;
}

export interface AipEvalRubric {
  /** Require taskSuccess === true. */
  requireTaskSuccess?: boolean;
  /** Minimum groundedness score [0,1]. */
  minGroundedness?: number;
  /** Maximum allowed permission violations. */
  maxPermissionViolations?: number;
  /** Maximum hallucination flags. */
  maxHallucinations?: number;
  /** Must not propose any of these action api names. */
  forbidActionApiNames?: string[];
  /** Substrings that must not appear in the answer (exfiltration). */
  forbidAnswerSubstrings?: string[];
  /** Must finish within this many ms (soft; recorded as latencyMs). */
  maxLatencyMs?: number;
}

export interface AipEvalCase {
  id: string;
  version: string;
  mode: AipEvalMode;
  input: string;
  context?: Record<string, unknown>;
  allowedTools: string[];
  expectedFacts?: string[];
  expectedAction?: AipEvalExpectedAction;
  forbiddenActions?: string[];
  rubric: AipEvalRubric;
  modelVersion: string;
  promptVersion: string;
  agentVersion: string;
  /** When set, case is one of the 11 mandatory adversarials. */
  adversarial?: AipAdversarialKind;
  /** Optional notes for humans / error analysis. */
  notes?: string;
}

export interface AipEvalMetrics {
  taskSuccess: boolean;
  groundedness: number;
  toolSelectionAccuracy: number;
  permissionViolations: number;
  hallucination: number;
  latencyMs: number;
  costUnits: number;
  humanOverride: boolean;
}

export interface AipEvalCaseResult {
  caseId: string;
  caseVersion: string;
  passed: boolean;
  metrics: AipEvalMetrics;
  failures: string[];
  answer?: string;
  toolsUsed?: string[];
  proposedActionApiName?: string;
  finalState?: string;
  modelVersion: string;
  promptVersion: string;
  agentVersion: string;
  adversarial?: AipAdversarialKind;
}

export interface AipEvalSuiteResult {
  suiteId: string;
  suiteVersion: string;
  passed: boolean;
  results: AipEvalCaseResult[];
  adversarialCoverage: {
    required: readonly AipAdversarialKind[];
    covered: AipAdversarialKind[];
    missing: AipAdversarialKind[];
  };
}

export function assertAipEvalCase(raw: unknown): AipEvalCase {
  if (!raw || typeof raw !== 'object') throw new Error('AipEvalCase: expected object');
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '');
  const version = String(o.version ?? '');
  const mode = o.mode === 'agent' ? 'agent' : o.mode === 'ask' ? 'ask' : '';
  const input = String(o.input ?? '');
  if (!id) throw new Error('AipEvalCase: id required');
  if (!version) throw new Error('AipEvalCase: version required');
  if (!mode) throw new Error('AipEvalCase: mode must be ask|agent');
  if (!input) throw new Error('AipEvalCase: input required');
  const allowedTools = Array.isArray(o.allowedTools)
    ? o.allowedTools.map((t) => String(t))
    : [];
  const rubric =
    o.rubric && typeof o.rubric === 'object' ? (o.rubric as AipEvalRubric) : {};
  const modelVersion = String(o.modelVersion ?? '');
  const promptVersion = String(o.promptVersion ?? '');
  const agentVersion = String(o.agentVersion ?? '');
  if (!modelVersion || !promptVersion || !agentVersion) {
    throw new Error('AipEvalCase: modelVersion, promptVersion, agentVersion required');
  }
  const out: AipEvalCase = {
    id,
    version,
    mode,
    input,
    allowedTools,
    rubric,
    modelVersion,
    promptVersion,
    agentVersion,
  };
  if (o.context && typeof o.context === 'object') {
    out.context = o.context as Record<string, unknown>;
  }
  if (Array.isArray(o.expectedFacts)) {
    out.expectedFacts = o.expectedFacts.map((f) => String(f));
  }
  if (o.expectedAction && typeof o.expectedAction === 'object') {
    const ea = o.expectedAction as Record<string, unknown>;
    const actionApiName = String(ea.actionApiName ?? '');
    if (!actionApiName) throw new Error('AipEvalCase: expectedAction.actionApiName required');
    out.expectedAction = {
      actionApiName,
      ...(ea.parameters && typeof ea.parameters === 'object'
        ? { parameters: ea.parameters as Record<string, unknown> }
        : {}),
    };
  }
  if (Array.isArray(o.forbiddenActions)) {
    out.forbiddenActions = o.forbiddenActions.map((f) => String(f));
  }
  if (typeof o.adversarial === 'string') {
    if (!(AIP_ADVERSARIAL_KINDS as readonly string[]).includes(o.adversarial)) {
      throw new Error(`AipEvalCase: unknown adversarial ${o.adversarial}`);
    }
    out.adversarial = o.adversarial as AipAdversarialKind;
  }
  if (typeof o.notes === 'string') out.notes = o.notes;
  return out;
}
