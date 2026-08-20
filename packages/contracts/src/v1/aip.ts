/**
 * contracts — AIP Gateway + Agent (Passo 35–36 / ADR-0022, ADR-0023).
 * ask = read-only. agent run = state-machine propose via ActionExecutor only.
 */

import type {
  ActionApplyRequest,
  ActionApplyResult,
  ActionValidateRequest,
  ActionValidateResult,
} from './action-runtime.js';

export type AipRiskLevel = 'read' | 'propose';

export interface ObjectCitation {
  ontologyId: string;
  objectTypeId: string;
  primaryKey: string;
}

export interface AipAskRequest {
  ontologyId: string;
  message: string;
  principal: string;
  conversationId?: string;
  profileId?: string;
}

export interface AipAskResponse {
  answer: string;
  citations: ObjectCitation[];
  toolsUsed: string[];
  modelId: string;
  traceId: string;
}

export interface AipToolDefinition {
  toolId: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredPermission: string;
  riskLevel: AipRiskLevel;
  timeoutMs: number;
  rateLimit?: number;
}

export type LlmMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface LlmToolCall {
  id: string;
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  tools: AipToolDefinition[];
  maxTokens?: number;
}

export interface LlmCompletionResult {
  modelId: string;
  content?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmProvider {
  readonly id: string;
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

/** Read surface for AIP tools — already policy-gated by the host. */
export interface AipObjectReader {
  listObjectTypes(principal: string, ontologyId: string): Promise<string[]>;
  getObject(
    principal: string,
    ontologyId: string,
    objectTypeId: string,
    primaryKey: string,
  ): Promise<{ objectTypeId: string; primaryKey: string; properties: Record<string, unknown> } | undefined>;
  loadObjectSet(
    principal: string,
    ontologyId: string,
    objectTypeId: string,
    limit: number,
  ): Promise<Array<{ objectTypeId: string; primaryKey: string; properties: Record<string, unknown> }>>;
  graphNeighbors(
    principal: string,
    ontologyId: string,
    objectTypeId: string,
    primaryKey: string,
    linkTypeId?: string,
  ): Promise<Array<{ objectTypeId: string; primaryKey: string; linkTypeId: string }>>;
}

/**
 * Mutation port for Passo 36 — wraps ActionExecutor only (ADR-0023).
 * Agent must not receive ObjectRepository writers.
 */
export interface AipActionPort {
  validate(req: ActionValidateRequest): Promise<ActionValidateResult>;
  apply(req: ActionApplyRequest): Promise<ActionApplyResult>;
}

export type AipAgentStateId =
  | 'START'
  | 'UNDERSTAND'
  | 'GATHER_DATA'
  | 'ANALYZE'
  | 'PROPOSE_ACTION'
  | 'AWAITING_APPROVAL'
  | 'VERIFY'
  | 'DONE'
  | 'FAILED';

export interface AipAgentStateStep {
  state: AipAgentStateId;
  toolsUsed: string[];
  note?: string;
}

export interface AipAgentRunRequest {
  ontologyId: string;
  message: string;
  principal: string;
  conversationId?: string;
  profileId?: string;
  /** Optional scripted proposal for deterministic tests (bypasses LLM tool choice). */
  proposedAction?: {
    actionApiName: string;
    parameters: Record<string, unknown>;
    idempotencyKey?: string;
  };
}

export interface AipAgentRunResponse {
  answer: string;
  citations: ObjectCitation[];
  toolsUsed: string[];
  modelId: string;
  traceId: string;
  finalState: AipAgentStateId;
  stateHistory: AipAgentStateStep[];
  /** Set when Action apply paused for human approval. */
  proposedExecutionId?: string;
  proposedActionStatus?: ActionApplyResult['status'];
}

export interface AipProfile {
  id: string;
  name: string;
  role: string;
  systemTemplate: string;
  allowedObjectTypeIds?: string[];
}

export function assertAipAskRequest(raw: unknown): AipAskRequest {
  if (!raw || typeof raw !== 'object') throw new Error('AipAskRequest: expected object');
  const o = raw as Record<string, unknown>;
  const ontologyId = String(o.ontologyId ?? '');
  const message = String(o.message ?? '');
  const principal = String(o.principal ?? '');
  if (!ontologyId) throw new Error('AipAskRequest: ontologyId required');
  if (!message) throw new Error('AipAskRequest: message required');
  if (!principal) throw new Error('AipAskRequest: principal required');
  if (message.length > 8_000) throw new Error('AipAskRequest: message too long');
  const out: AipAskRequest = { ontologyId, message, principal };
  if (typeof o.conversationId === 'string' && o.conversationId) out.conversationId = o.conversationId;
  if (typeof o.profileId === 'string' && o.profileId) out.profileId = o.profileId;
  return out;
}

export function assertAipAgentRunRequest(raw: unknown): AipAgentRunRequest {
  const base = assertAipAskRequest(raw);
  const o = raw as Record<string, unknown>;
  const out: AipAgentRunRequest = { ...base };
  if (o.proposedAction && typeof o.proposedAction === 'object') {
    const p = o.proposedAction as Record<string, unknown>;
    const actionApiName = String(p.actionApiName ?? '');
    if (!actionApiName) throw new Error('AipAgentRunRequest: proposedAction.actionApiName required');
    const parameters =
      p.parameters && typeof p.parameters === 'object' && !Array.isArray(p.parameters)
        ? (p.parameters as Record<string, unknown>)
        : {};
    out.proposedAction = {
      actionApiName,
      parameters,
      ...(typeof p.idempotencyKey === 'string' && p.idempotencyKey
        ? { idempotencyKey: p.idempotencyKey }
        : {}),
    };
  }
  return out;
}
