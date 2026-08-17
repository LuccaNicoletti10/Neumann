/**
 * action-engine — src/core/workflow.ts
 * Ordered actions with dependencies (US 8,429,194 / US 8,905,597).
 * Each step runs through the same ActionExecutor pipeline.
 * LLM/UI never write objects — only Action apply does.
 */

import type {
  ActionApplyResult,
  ActionExecutor,
  ActionWorkflowApplyRequest,
  ActionWorkflowApplyResult,
  ActionWorkflowDef,
  ActionWorkflowStep,
} from 'contracts';

export class ActionWorkflowError extends Error {
  override readonly name = 'ActionWorkflowError';
}

function resolveBinding(
  spec: string,
  workflowParams: Record<string, unknown>,
): unknown {
  if (spec.startsWith('$')) {
    return workflowParams[spec.slice(1)];
  }
  return spec;
}

export function topologicalSteps(workflow: ActionWorkflowDef): ActionWorkflowStep[] {
  const byId = new Map(workflow.steps.map((s) => [s.id, s]));
  if (byId.size !== workflow.steps.length) {
    throw new ActionWorkflowError('duplicate workflow step id');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: ActionWorkflowStep[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new ActionWorkflowError(`cyclic workflow dependency at ${id}`);
    }
    const step = byId.get(id);
    if (!step) throw new ActionWorkflowError(`unknown workflow step: ${id}`);
    visiting.add(id);
    for (const dep of step.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(step);
  }

  for (const step of workflow.steps) visit(step.id);
  return order;
}

export function resolveStepParameters(
  step: ActionWorkflowStep,
  workflowParams: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(step.parameterBindings)) {
    params[name] = resolveBinding(spec, workflowParams);
  }
  return params;
}

/**
 * Collect `fromStepId` and every step that transitively depends on it.
 */
export function dependentSteps(
  workflow: ActionWorkflowDef,
  fromStepId: string,
): Set<string> {
  const out = new Set<string>([fromStepId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const step of workflow.steps) {
      if (out.has(step.id)) continue;
      if ((step.dependsOn ?? []).some((d) => out.has(d))) {
        out.add(step.id);
        grew = true;
      }
    }
  }
  return out;
}

export function createActionWorkflowRunner(executor: ActionExecutor) {
  async function runSteps(
    req: ActionWorkflowApplyRequest,
    steps: ActionWorkflowStep[],
  ): Promise<ActionWorkflowApplyResult> {
    const stepResults: ActionApplyResult[] = [];
    for (const step of steps) {
      const parameters = resolveStepParameters(step, req.parameters);
      const result = await executor.apply({
        ontologyId: req.ontologyId,
        actionApiName: step.actionApiName,
        parameters,
        principal: req.principal,
        idempotencyKey: req.idempotencyKey
          ? `${req.idempotencyKey}:${step.id}`
          : undefined,
        expectedObjectVersions: req.expectedObjectVersions,
      });
      stepResults.push(result);
      if (result.status !== 'SUCCEEDED' && result.status !== 'AWAITING_APPROVAL') {
        return {
          status: result.status,
          stepResults,
          error: result.error ?? `step ${step.id} ${result.status}`,
        };
      }
    }
    return { status: 'SUCCEEDED', stepResults };
  }

  return {
    async apply(req: ActionWorkflowApplyRequest): Promise<ActionWorkflowApplyResult> {
      return runSteps(req, topologicalSteps(req.workflow));
    },

    /**
     * Re-run a step and every dependent (document-workflow reprocess).
     */
    async reprocess(
      req: ActionWorkflowApplyRequest,
      fromStepId: string,
    ): Promise<ActionWorkflowApplyResult> {
      const needed = dependentSteps(req.workflow, fromStepId);
      const steps = topologicalSteps(req.workflow).filter((s) => needed.has(s.id));
      return runSteps(req, steps);
    },
  };
}
