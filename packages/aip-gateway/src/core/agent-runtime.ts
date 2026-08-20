/**
 * aip-gateway — read-only agent loop (LLM ↔ tools).
 */

import type {
  AipAskRequest,
  AipObjectReader,
  AipProfile,
  LlmMessage,
  LlmProvider,
  ObjectCitation,
} from 'contracts';

import { citationsFromToolPayload, uniqueCitations } from './citations.js';
import { renderSystemPrompt } from './context-builder.js';
import { filterAipOutput } from './output-filter.js';
import type { AipToolRegistry } from './tool-registry.js';

export interface AgentRuntimeOptions {
  llm: LlmProvider;
  tools: AipToolRegistry;
  reads: AipObjectReader;
  maxIterations?: number;
}

export interface AgentTurnResult {
  answer: string;
  citations: ObjectCitation[];
  toolsUsed: string[];
  modelId: string;
  forbiddenSubstrings: string[];
}

export async function runReadOnlyAgentTurn(
  req: AipAskRequest,
  profile: AipProfile,
  opts: AgentRuntimeOptions,
): Promise<AgentTurnResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: renderSystemPrompt(profile, {
        ontologyId: req.ontologyId,
        principal: req.principal,
      }),
    },
    { role: 'user', content: req.message },
  ];

  const toolsUsed: string[] = [];
  const citations: ObjectCitation[] = [];
  const forbiddenSubstrings: string[] = [];
  let modelId = opts.llm.id;
  const toolDefs = opts.tools.list();

  for (let i = 0; i < maxIterations; i++) {
    let completion;
    try {
      completion = await opts.llm.complete({
        messages,
        tools: toolDefs,
      });
    } catch (err) {
      return {
        answer:
          err instanceof Error
            ? `Model outage: ${err.message}`
            : 'Model outage: LLM unavailable',
        citations: uniqueCitations(citations),
        toolsUsed: [...new Set(toolsUsed)],
        modelId,
        forbiddenSubstrings,
      };
    }
    modelId = completion.modelId || opts.llm.id;

    if (completion.toolCalls && completion.toolCalls.length > 0) {
      if (completion.content) {
        messages.push({ role: 'assistant', content: completion.content });
      }
      for (const call of completion.toolCalls) {
        toolsUsed.push(call.toolId);
        let payload: unknown;
        try {
          payload = await opts.tools.invoke(call.toolId, call.arguments, {
            principal: req.principal,
            ontologyId: req.ontologyId,
            reads: opts.reads,
          });
        } catch (err) {
          payload = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
        collectForbidden(payload, forbiddenSubstrings);
        citations.push(...citationsFromToolPayload(req.ontologyId, payload));
        messages.push({
          role: 'tool',
          name: call.toolId,
          toolCallId: call.id,
          content: JSON.stringify(payload ?? null),
        });
      }
      continue;
    }

    const rawAnswer = completion.content?.trim() || '';
    const filtered = filterAipOutput({
      answer: rawAnswer || 'No answer produced.',
      allowedCitations: uniqueCitations(citations),
      forbiddenSubstrings,
    });
    return {
      answer: filtered.answer,
      citations: filtered.citations.length > 0 ? filtered.citations : uniqueCitations(citations),
      toolsUsed: [...new Set(toolsUsed)],
      modelId,
      forbiddenSubstrings,
    };
  }

  return {
    answer: 'Stopped: max tool iterations reached without a final answer.',
    citations: uniqueCitations(citations),
    toolsUsed: [...new Set(toolsUsed)],
    modelId,
    forbiddenSubstrings,
  };
}

function collectForbidden(payload: unknown, into: string[]): void {
  // Host may mark sensitive raw values; for Degrau 1 we track explicit markers only.
  if (!payload || typeof payload !== 'object') return;
  const o = payload as Record<string, unknown>;
  if (Array.isArray(o._forbiddenEcho)) {
    for (const v of o._forbiddenEcho) {
      if (typeof v === 'string' && v.length >= 2) into.push(v);
    }
  }
}
