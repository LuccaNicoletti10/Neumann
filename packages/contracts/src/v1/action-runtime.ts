/**
 * contracts — src/v1/action-runtime.ts
 * Action execution lifecycle contracts (Passo 24).
 */

import type {
  ActionTypeDef,
  ActionTypeId,
  OntologyId,
  OntologyVersionId,
} from './ontology.js';
import type { PrincipalId } from './policy.js';

export type ActionExecutionId = string;

export type ActionExecutionStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'VALIDATED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DENIED';

export interface ActionValidateRequest {
  ontologyId: OntologyId;
  actionApiName: string;
  parameters: Record<string, unknown>;
  principal: PrincipalId;
}

export interface ActionValidateResult {
  valid: boolean;
  errors: { field?: string; message: string }[];
  submissionCriteriaMet: boolean;
}

export interface ActionApplyRequest {
  ontologyId: OntologyId;
  ontologyVersionId?: OntologyVersionId;
  actionApiName: string;
  parameters: Record<string, unknown>;
  principal: PrincipalId;
  idempotencyKey?: string;
  /** Optimistic concurrency: objectTypeId::primaryKey → version */
  expectedObjectVersions?: Record<string, number>;
}

export interface ActionApplyResult {
  executionId: ActionExecutionId;
  status: ActionExecutionStatus;
  actionTypeId: ActionTypeId;
  result?: Record<string, unknown>;
  error?: string;
  auditEntryId?: string;
}

export interface ActionExecution {
  id: ActionExecutionId;
  ontologyId: OntologyId;
  actionTypeId: ActionTypeId;
  actionApiName: string;
  parameters: Record<string, unknown>;
  principal: PrincipalId;
  status: ActionExecutionStatus;
  idempotencyKey?: string;
  startedAt: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
  auditEntryId?: string;
}

/**
 * ActionExecutor lifecycle:
 * request → authorize → validate parameters → submission criteria
 * → ontology rules → side effects → audit → result
 */
export interface ActionExecutor {
  getActionType(ontologyId: OntologyId, apiName: string): ActionTypeDef | undefined;
  registerActionType(ontologyId: OntologyId, def: ActionTypeDef): void;
  validate(req: ActionValidateRequest): Promise<ActionValidateResult> | ActionValidateResult;
  apply(req: ActionApplyRequest): Promise<ActionApplyResult> | ActionApplyResult;
  getExecution(id: ActionExecutionId): ActionExecution | undefined;
}
