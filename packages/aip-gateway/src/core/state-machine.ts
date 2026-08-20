/**
 * aip-gateway — fixed agent state machine (Passo 36 / ADR-0023 / EP4530883).
 * LLM cannot invent states; transitions are declared here.
 */

import type { AipAgentStateId } from 'contracts';

export interface AgentStateDef {
  id: AipAgentStateId;
  allowedTools: readonly string[];
  maxIterations: number;
  prompt: string;
  /** Next states the runtime may enter after this step. */
  next: readonly AipAgentStateId[];
}

/** Canonical Degrau 2–4 machine (guide Passo 36). */
export const DEFAULT_AGENT_MACHINE: readonly AgentStateDef[] = [
  {
    id: 'START',
    allowedTools: [],
    maxIterations: 1,
    prompt: 'Acknowledge the user goal. Do not call tools yet.',
    next: ['UNDERSTAND'],
  },
  {
    id: 'UNDERSTAND',
    allowedTools: ['list_object_types'],
    maxIterations: 2,
    prompt: 'Clarify which ontology types are relevant. Use list_object_types if needed.',
    next: ['GATHER_DATA'],
  },
  {
    id: 'GATHER_DATA',
    allowedTools: ['get_object', 'load_object_set', 'graph_neighbors', 'list_object_types'],
    maxIterations: 4,
    prompt: 'Gather facts with read tools only. Do not propose Actions yet.',
    next: ['ANALYZE'],
  },
  {
    id: 'ANALYZE',
    allowedTools: ['get_object', 'load_object_set'],
    maxIterations: 2,
    prompt: 'Summarize gathered facts. Decide whether an Action is warranted.',
    next: ['PROPOSE_ACTION', 'DONE'],
  },
  {
    id: 'PROPOSE_ACTION',
    allowedTools: ['validate_action', 'propose_action'],
    maxIterations: 3,
    prompt:
      'Validate then propose exactly one Action via propose_action. Never invent writes outside that tool.',
    next: ['AWAITING_APPROVAL', 'VERIFY', 'FAILED'],
  },
  {
    id: 'AWAITING_APPROVAL',
    allowedTools: [],
    maxIterations: 1,
    prompt: 'Stop. Human must approve via ActionExecutor.approve — not the LLM.',
    next: ['DONE'],
  },
  {
    id: 'VERIFY',
    allowedTools: ['get_object'],
    maxIterations: 2,
    prompt: 'Verify post-action object state with read tools if an Action already succeeded.',
    next: ['DONE'],
  },
  {
    id: 'DONE',
    allowedTools: [],
    maxIterations: 1,
    prompt: 'Emit the final answer with citations.',
    next: [],
  },
  {
    id: 'FAILED',
    allowedTools: [],
    maxIterations: 1,
    prompt: 'Explain failure without inventing facts.',
    next: [],
  },
] as const;

export function stateDef(id: AipAgentStateId): AgentStateDef {
  const hit = DEFAULT_AGENT_MACHINE.find((s) => s.id === id);
  if (!hit) throw new Error(`unknown agent state: ${id}`);
  return hit;
}

export function canTransition(from: AipAgentStateId, to: AipAgentStateId): boolean {
  return stateDef(from).next.includes(to);
}
