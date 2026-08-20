import type { ActionApplyRequest, ActionApplyResult } from 'contracts';

export interface FunctionActionInvoker {
  apply(req: ActionApplyRequest): Promise<ActionApplyResult>;
}

export function derivedActionIdempotencyKey(functionExecutionId: string, step: string): string {
  return `fn:${functionExecutionId}:${step}`;
}
