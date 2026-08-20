/**
 * platform-api — AIP ask + agent routes (Passo 35–36).
 */

import type { FastifyInstance } from 'fastify';
import { assertAipAgentRunRequest, assertAipAskRequest } from 'contracts';
import {
  createAiAgent,
  createAiGateway,
  createMockLlm,
  createOpenAiCompatibleLlm,
} from 'aip-gateway';
import { ResourceIds } from 'policy-engine';
import { NeumannApiError } from 'api-errors';

import type { PublicPlatformContext } from '../core/context.js';
import { createAipObjectReader } from '../core/aip-reads.js';
import { principalOf } from '../core/principal.js';
import { declarePolicy } from '../core/route-policy.js';

export async function registerAipRoutes(
  app: FastifyInstance,
  ctx: PublicPlatformContext,
): Promise<void> {
  app.post(
    '/api/v2/ontologies/:ontologyId/aip/ask',
    declarePolicy('read', () => ResourceIds.admin('aip-ask'), false),
    async (request, reply) => {
      const ontologyId = String((request.params as { ontologyId: string }).ontologyId);
      const principal = principalOf(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      let askReq;
      try {
        askReq = assertAipAskRequest({
          ...body,
          ontologyId,
          principal,
        });
      } catch (err) {
        return reply.code(400).send(
          new NeumannApiError({
            errorCode: 'INVALID_ARGUMENT',
            errorName: 'InvalidAipAsk',
            message: err instanceof Error ? err.message : String(err),
          }).toJSON(),
        );
      }

      const llm = resolveAipLlm('ask');
      const gateway = createAiGateway({
        reads: createAipObjectReader(ctx),
        llm,
      });
      const result = await gateway.ask(askReq);
      return reply.send(result);
    },
  );

  app.post(
    '/api/v2/ontologies/:ontologyId/aip/agent/run',
    declarePolicy('modify', () => ResourceIds.admin('aip-agent'), false),
    async (request, reply) => {
      const ontologyId = String((request.params as { ontologyId: string }).ontologyId);
      const principal = principalOf(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      let runReq;
      try {
        runReq = assertAipAgentRunRequest({
          ...body,
          ontologyId,
          principal,
        });
      } catch (err) {
        return reply.code(400).send(
          new NeumannApiError({
            errorCode: 'INVALID_ARGUMENT',
            errorName: 'InvalidAipAgentRun',
            message: err instanceof Error ? err.message : String(err),
          }).toJSON(),
        );
      }

      const llm = resolveAipLlm('agent');
      const agent = createAiAgent({
        reads: createAipObjectReader(ctx),
        actions: {
          validate: (r) => ctx.actions.validate(r),
          apply: (r) => ctx.actions.apply(r),
        },
        llm,
      });
      const result = await agent.run(runReq);
      return reply.send(result);
    },
  );
}

function resolveAipLlm(mode: 'ask' | 'agent') {
  const env = process.env.PLATFORM_ENV ?? process.env.NODE_ENV ?? 'development';
  const baseUrl = process.env.AIP_LLM_BASE_URL;
  const apiKey = process.env.AIP_LLM_API_KEY;
  const model = process.env.AIP_LLM_MODEL ?? 'gpt-4o-mini';

  if (baseUrl && apiKey) {
    return createOpenAiCompatibleLlm({ baseUrl, apiKey, model });
  }

  // WHY: production must not silently fall back to MockLlm (ADR-0022/0023).
  if (env === 'production') {
    throw new Error('production refused: AIP_LLM_BASE_URL and AIP_LLM_API_KEY are required');
  }

  if (mode === 'agent') {
    return createMockLlm({
      script: {
        kind: 'text',
        content: 'Agent demo MockLlm — use proposedAction in tests for deterministic propose.',
      },
    });
  }

  return createMockLlm({
    script: {
      kind: 'tools',
      calls: [
        {
          toolId: 'list_object_types',
          arguments: {},
        },
      ],
      thenText: 'Listed object types from the ontology (demo MockLlm).',
    },
  });
}
