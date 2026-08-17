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
  | 'AWAITING_APPROVAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DENIED'
  | 'REJECTED';

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
  approval?: {
    required: boolean;
    requestedAt?: string;
    decidedAt?: string;
    decidedBy?: PrincipalId;
    decision?: 'approved' | 'rejected';
  };
}

export interface ActionExecutionClaimResult {
  /** True when this caller inserted the row and must run the action. */
  claimed: boolean;
  execution: ActionExecution;
}

/** Durable ActionExecution + idempotency (unique key in PostgreSQL). */
export interface ActionExecutionStore {
  save(execution: ActionExecution): Promise<void>;
  get(id: ActionExecutionId): Promise<ActionExecution | undefined>;
  findByIdempotencyKey(
    ontologyId: OntologyId,
    actionApiName: string,
    idempotencyKey: string,
  ): Promise<ActionExecution | undefined>;
  /**
   * Insert PENDING execution claiming the idempotency key.
   * Concurrent claims: exactly one `claimed: true`.
   */
  claim(execution: ActionExecution): Promise<ActionExecutionClaimResult>;
  /**
   * Compare-and-swap status. Returns the updated row, or undefined if `from` did not match.
   */
  casStatus?(
    id: ActionExecutionId,
    from: ActionExecutionStatus,
    to: ActionExecutionStatus,
    patch?: Partial<ActionExecution>,
  ): Promise<ActionExecution | undefined>;
}

/** Nested parameter node (US 8,732,574 family — parameter tree). */
export interface ActionParameterNode {
  name: string;
  value: unknown;
  type: 'primitive' | 'object_reference' | 'variable';
  objectTypeId?: string;
  referencedPrimaryKey?: string;
  variableName?: string;
  children: ActionParameterNode[];
}

export interface ActionParameterTree {
  actionApiName: string;
  actionTypeId: ActionTypeId;
  nodes: ActionParameterNode[];
}

/** Ordered action steps with dependencies (US 8,429,194 / US 8,905,597). */
export interface ActionWorkflowStep {
  id: string;
  actionApiName: string;
  /** Step param → workflow param name (`$foo`) or literal. */
  parameterBindings: Record<string, string>;
  dependsOn?: string[];
}

export interface ActionWorkflowDef {
  id: string;
  displayName: string;
  steps: ActionWorkflowStep[];
}

export interface ActionWorkflowApplyRequest {
  ontologyId: OntologyId;
  workflow: ActionWorkflowDef;
  parameters: Record<string, unknown>;
  principal: PrincipalId;
  idempotencyKey?: string;
  expectedObjectVersions?: Record<string, number>;
}

export interface ActionWorkflowApplyResult {
  status: ActionExecutionStatus;
  stepResults: ActionApplyResult[];
  error?: string;
}

/**
 * ActionExecutor lifecycle:
 * request → authorize → validate → tx → write-back → audit
 */
export interface ActionExecutor {
  getActionType(ontologyId: OntologyId, apiName: string): ActionTypeDef | undefined;
  registerActionType(ontologyId: OntologyId, def: ActionTypeDef): void;
  validate(req: ActionValidateRequest): Promise<ActionValidateResult>;
  apply(req: ActionApplyRequest): Promise<ActionApplyResult>;
  getExecution(id: ActionExecutionId): Promise<ActionExecution | undefined>;
  approve?(id: ActionExecutionId, principal: PrincipalId): Promise<ActionApplyResult>;
  reject?(id: ActionExecutionId, principal: PrincipalId): Promise<ActionApplyResult>;
  parameterTree?(req: ActionValidateRequest): Promise<ActionParameterTree>;
}
