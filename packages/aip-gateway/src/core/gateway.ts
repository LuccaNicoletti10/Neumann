/**
 * aip-gateway — createAiGateway (Passo 35 / ADR-0022).
 */

import type {
  AipAskRequest,
  AipAskResponse,
  AipObjectReader,
  AipProfile,
  LlmProvider,
} from 'contracts';
import { createUuidIdGenerator, type Clock, type IdGenerator } from 'object-platform';

import { runReadOnlyAgentTurn } from './agent-runtime.js';
import { DEFAULT_AIP_PROFILE, resolveProfile } from './context-builder.js';
import {
  createToolRegistry,
  registerDefaultReadTools,
  type AipToolRegistry,
} from './tool-registry.js';

export interface CreateAiGatewayOptions {
  reads: AipObjectReader;
  llm: LlmProvider;
  profiles?: readonly AipProfile[];
  tools?: AipToolRegistry;
  clock?: Clock;
  nextId?: IdGenerator;
  maxIterations?: number;
}

export interface AiGateway {
  ask(req: AipAskRequest): Promise<AipAskResponse>;
}

export function createAiGateway(opts: CreateAiGatewayOptions): AiGateway {
  if (!opts.reads) throw new Error('createAiGateway: reads required');
  if (!opts.llm) throw new Error('createAiGateway: llm required');

  const nextId = opts.nextId ?? createUuidIdGenerator();
  const profiles = opts.profiles?.length ? opts.profiles : [DEFAULT_AIP_PROFILE];
  const tools = opts.tools ?? createToolRegistry();
  if (!opts.tools) registerDefaultReadTools(tools);

  return {
    async ask(req) {
      if (!req.principal) throw new Error('AipAskRequest: principal required');
      if (!req.ontologyId) throw new Error('AipAskRequest: ontologyId required');
      if (!req.message?.trim()) throw new Error('AipAskRequest: message required');

      const profile = resolveProfile(profiles, req.profileId);
      const turn = await runReadOnlyAgentTurn(req, profile, {
        llm: opts.llm,
        tools,
        reads: opts.reads,
        maxIterations: opts.maxIterations,
      });

      return {
        answer: turn.answer,
        citations: turn.citations,
        toolsUsed: turn.toolsUsed,
        modelId: turn.modelId,
        traceId: nextId('aip'),
      };
    },
  };
}
