/**
 * aip-gateway — state-machine agent runtime (Passo 36 / ADR-0023).
 */

import type {
  AipActionPort,
  AipAgentRunRequest,
  AipAgentRunResponse,
  AipAgentStateId,
  AipAgentStateStep,
  AipObjectReader,
  AipProfile,
  LlmMessage,
  LlmProvider,
  ObjectCitation,
} from 'contracts';
import { createUuidIdGenerator, type IdGenerator } from 'object-platform';

import { citationsFromToolPayload, uniqueCitations } from './citations.js';
import { resolveProfile, renderSystemPrompt } from './context-builder.js';
import {
  formatFewShotBlock,
  selectIdealExamples,
  type FewShotExample,
} from './few-shot.js';
import { filterAipOutput } from './output-filter.js';
import { canTransition, stateDef } from './state-machine.js';
import {
  createToolRegistry,
  registerDefaultReadTools,
  registerProposeTools,
  type AipToolRegistry,
} from './tool-registry.js';

export interface CreateAiAgentOptions {
  reads: AipObjectReader;
  actions: AipActionPort;
  llm: LlmProvider;
  profiles?: readonly AipProfile[];
  tools?: AipToolRegistry;
  nextId?: IdGenerator;
  fewShotExamples?: readonly FewShotExample[];
}

export interface AiAgent {
  run(req: AipAgentRunRequest): Promise<AipAgentRunResponse>;
}

export function createAiAgent(opts: CreateAiAgentOptions): AiAgent {
  if (!opts.reads) throw new Error('createAiAgent: reads required');
  if (!opts.actions) throw new Error('createAiAgent: actions required');
  if (!opts.llm) throw new Error('createAiAgent: llm required');

  const nextId = opts.nextId ?? createUuidIdGenerator();
  const profiles = opts.profiles?.length ? opts.profiles : [DEFAULT_AGENT_PROFILE];
  const tools = opts.tools ?? createToolRegistry({ allowPropose: true });
  if (!opts.tools) {
    registerDefaultReadTools(tools);
    registerProposeTools(tools);
  }

  return {
    async run(req) {
      if (!req.principal) throw new Error('AipAgentRunRequest: principal required');
      if (!req.ontologyId) throw new Error('AipAgentRunRequest: ontologyId required');
      if (!req.message?.trim()) throw new Error('AipAgentRunRequest: message required');

      const profile = resolveProfile(profiles, req.profileId);
      const fewShot = opts.fewShotExamples?.length
        ? formatFewShotBlock(selectIdealExamples(opts.fewShotExamples, req.message, 3))
        : '';

      return runStateMachineAgent(req, profile, {
        llm: opts.llm,
        tools,
        reads: opts.reads,
        actions: opts.actions,
        nextId,
        fewShot,
      });
    },
  };
}

export const DEFAULT_AGENT_PROFILE: AipProfile = {
  id: 'agent-default',
  name: 'Action Proposer',
  role: 'proposer',
  systemTemplate: [
    'You are a state-machine agent over a versioned Ontology.',
    'Follow the current state instructions exactly.',
    'Use only allowed tools for this state.',
    'Mutations happen only via propose_action (ActionExecutor). Never invent object writes.',
    'Profile role: {role}. Ontology: {ontologyId}. Principal: {principal}.',
  ].join(' '),
};

interface RuntimeOpts {
  llm: LlmProvider;
  tools: AipToolRegistry;
  reads: AipObjectReader;
  actions: AipActionPort;
  nextId: IdGenerator;
  fewShot: string;
}

async function runStateMachineAgent(
  req: AipAgentRunRequest,
  profile: AipProfile,
  opts: RuntimeOpts,
): Promise<AipAgentRunResponse> {
  const stateHistory: AipAgentStateStep[] = [];
  const toolsUsed: string[] = [];
  const citations: ObjectCitation[] = [];
  const forbiddenSubstrings: string[] = [];
  let modelId = opts.llm.id;
  let state: AipAgentStateId = 'START';
  let proposedExecutionId: string | undefined;
  let proposedActionStatus: AipAgentRunResponse['proposedActionStatus'];
  let answer = '';

  // Deterministic test hatch: skip LLM and propose directly after gather.
  if (req.proposedAction) {
    stateHistory.push({ state: 'START', toolsUsed: [], note: 'scripted' });
    transition(stateHistory, 'START', 'UNDERSTAND');
    transition(stateHistory, 'UNDERSTAND', 'GATHER_DATA');
    transition(stateHistory, 'GATHER_DATA', 'ANALYZE');
    transition(stateHistory, 'ANALYZE', 'PROPOSE_ACTION');
    const validated = await opts.actions.validate({
      ontologyId: req.ontologyId,
      actionApiName: req.proposedAction.actionApiName,
      parameters: req.proposedAction.parameters,
      principal: req.principal,
    });
    toolsUsed.push('validate_action');
    if (!validated.valid) {
      return finish({
        answer: `Proposal invalid: ${validated.errors.map((e) => e.message).join('; ')}`,
        state: 'FAILED',
        stateHistory,
        toolsUsed,
        citations,
        modelId,
        nextId: opts.nextId,
      });
    }
    const applied = await opts.actions.apply({
      ontologyId: req.ontologyId,
      actionApiName: req.proposedAction.actionApiName,
      parameters: req.proposedAction.parameters,
      principal: req.principal,
      idempotencyKey: req.proposedAction.idempotencyKey,
    });
    toolsUsed.push('propose_action');
    proposedExecutionId = applied.executionId;
    proposedActionStatus = applied.status;
    if (applied.status === 'AWAITING_APPROVAL') {
      transition(stateHistory, 'PROPOSE_ACTION', 'AWAITING_APPROVAL');
      return finish({
        answer:
          `Action ${req.proposedAction.actionApiName} proposed and awaits human approval ` +
          `(execution ${applied.executionId}). Use ActionExecutor.approve — not the agent.`,
        state: 'AWAITING_APPROVAL',
        stateHistory,
        toolsUsed,
        citations,
        modelId,
        nextId: opts.nextId,
        proposedExecutionId,
        proposedActionStatus,
      });
    }
    if (applied.status === 'SUCCEEDED') {
      transition(stateHistory, 'PROPOSE_ACTION', 'VERIFY');
      transition(stateHistory, 'VERIFY', 'DONE');
      return finish({
        answer: `Action ${req.proposedAction.actionApiName} executed successfully (${applied.executionId}).`,
        state: 'DONE',
        stateHistory,
        toolsUsed,
        citations,
        modelId,
        nextId: opts.nextId,
        proposedExecutionId,
        proposedActionStatus,
      });
    }
    transition(stateHistory, 'PROPOSE_ACTION', 'FAILED');
    return finish({
      answer: `Action proposal failed: ${applied.error ?? applied.status}`,
      state: 'FAILED',
      stateHistory,
      toolsUsed,
      citations,
      modelId,
      nextId: opts.nextId,
      proposedExecutionId,
      proposedActionStatus,
    });
  }

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: [
        renderSystemPrompt(profile, {
          ontologyId: req.ontologyId,
          principal: req.principal,
        }),
        opts.fewShot,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    { role: 'user', content: req.message },
  ];

  const terminal: AipAgentStateId[] = ['DONE', 'FAILED', 'AWAITING_APPROVAL'];
  let guard = 0;
  while (!terminal.includes(state) && guard < 24) {
    guard += 1;
    const def = stateDef(state);
    const stepTools: string[] = [];
    messages.push({
      role: 'system',
      content: `Current state: ${def.id}. ${def.prompt} Allowed tools: ${def.allowedTools.join(', ') || '(none)'}.`,
    });

    if (def.allowedTools.length === 0) {
      // Auto-advance non-tool states.
      const next = def.next[0];
      if (!next) break;
      transition(stateHistory, state, next);
      state = next;
      continue;
    }

    const allowedDefs = opts.tools.list().filter((t) => def.allowedTools.includes(t.toolId));
    for (let i = 0; i < def.maxIterations; i++) {
      let completion;
      try {
        completion = await opts.llm.complete({
          messages,
          tools: allowedDefs,
        });
      } catch (err) {
        state = 'FAILED';
        answer =
          err instanceof Error
            ? `Model outage: ${err.message}`
            : 'Model outage: LLM unavailable';
        stateHistory.push({ state: 'FAILED', toolsUsed: [...new Set(stepTools)], note: answer });
        break;
      }
      modelId = completion.modelId || opts.llm.id;

      if (completion.toolCalls?.length) {
        for (const call of completion.toolCalls) {
          if (!def.allowedTools.includes(call.toolId)) {
            messages.push({
              role: 'tool',
              name: call.toolId,
              toolCallId: call.id,
              content: JSON.stringify({ error: `tool not allowed in state ${def.id}` }),
            });
            continue;
          }
          stepTools.push(call.toolId);
          toolsUsed.push(call.toolId);
          let payload: unknown;
          try {
            payload = await opts.tools.invoke(call.toolId, call.arguments, {
              principal: req.principal,
              ontologyId: req.ontologyId,
              reads: opts.reads,
              actions: opts.actions,
            });
          } catch (err) {
            payload = { error: err instanceof Error ? err.message : String(err) };
          }
          citations.push(...citationsFromToolPayload(req.ontologyId, payload));
          const status =
            payload && typeof payload === 'object'
              ? String((payload as Record<string, unknown>).status ?? '')
              : '';
          const executionId =
            payload && typeof payload === 'object'
              ? String((payload as Record<string, unknown>).executionId ?? '')
              : '';
          if (call.toolId === 'propose_action' && executionId) {
            proposedExecutionId = executionId;
            proposedActionStatus = status as AipAgentRunResponse['proposedActionStatus'];
          }
          messages.push({
            role: 'tool',
            name: call.toolId,
            toolCallId: call.id,
            content: JSON.stringify(payload ?? null),
          });
        }
        continue;
      }

      if (completion.content?.trim()) {
        answer = completion.content.trim();
        messages.push({ role: 'assistant', content: answer });
      }
      break;
    }

    if (state === 'FAILED') {
      continue;
    }

    stateHistory.push({
      state,
      toolsUsed: [...new Set(stepTools)],
      note: answer.slice(0, 120) || undefined,
    });

    // Transition policy (deterministic from tool outcomes).
    if (state === 'PROPOSE_ACTION') {
      if (proposedActionStatus === 'AWAITING_APPROVAL') {
        state = 'AWAITING_APPROVAL';
        continue;
      }
      if (proposedActionStatus === 'SUCCEEDED') {
        state = 'VERIFY';
        continue;
      }
      if (
        proposedActionStatus === 'FAILED' ||
        proposedActionStatus === 'DENIED' ||
        proposedActionStatus === 'REJECTED'
      ) {
        state = 'FAILED';
        continue;
      }
      // No proposal yet — fail if tools exhausted without propose.
      if (!proposedExecutionId) {
        state = 'FAILED';
        answer = answer || 'Agent did not propose an Action.';
        continue;
      }
    }

    const next = pickNext(state, answer);
    if (!next || next === state) {
      if (def.next.includes('DONE')) state = 'DONE';
      else break;
    } else {
      state = next;
    }
  }

  if (!answer) {
    answer =
      state === 'AWAITING_APPROVAL'
        ? `Awaiting approval for execution ${proposedExecutionId ?? '?'}.`
        : state === 'DONE'
          ? 'Done.'
          : `Stopped in state ${state}.`;
  }

  const filtered = filterAipOutput({
    answer,
    allowedCitations: uniqueCitations(citations),
    forbiddenSubstrings,
  });

  return finish({
    answer: filtered.answer,
    state: terminal.includes(state) ? state : state === 'VERIFY' ? 'DONE' : state,
    stateHistory,
    toolsUsed: [...new Set(toolsUsed)],
    citations: filtered.citations.length ? filtered.citations : uniqueCitations(citations),
    modelId,
    nextId: opts.nextId,
    proposedExecutionId,
    proposedActionStatus,
  });
}

function pickNext(state: AipAgentStateId, _answer: string): AipAgentStateId | undefined {
  const def = stateDef(state);
  return def.next[0];
}

function transition(
  history: AipAgentStateStep[],
  from: AipAgentStateId,
  to: AipAgentStateId,
): void {
  if (!canTransition(from, to) && from !== to) {
    // Scripted path still records; machine edges cover the scripted chain.
  }
  history.push({ state: to, toolsUsed: [] });
}

function finish(args: {
  answer: string;
  state: AipAgentStateId;
  stateHistory: AipAgentStateStep[];
  toolsUsed: string[];
  citations: ObjectCitation[];
  modelId: string;
  nextId: IdGenerator;
  proposedExecutionId?: string;
  proposedActionStatus?: AipAgentRunResponse['proposedActionStatus'];
}): AipAgentRunResponse {
  return {
    answer: args.answer,
    citations: args.citations,
    toolsUsed: args.toolsUsed,
    modelId: args.modelId,
    traceId: args.nextId('aip-agent'),
    finalState: args.state,
    stateHistory: args.stateHistory,
    ...(args.proposedExecutionId ? { proposedExecutionId: args.proposedExecutionId } : {}),
    ...(args.proposedActionStatus ? { proposedActionStatus: args.proposedActionStatus } : {}),
  };
}
