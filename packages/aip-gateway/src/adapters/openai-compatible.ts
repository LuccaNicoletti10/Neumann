/**
 * aip-gateway — OpenAI-compatible chat+tools adapter (zero policy).
 */

import type {
  AipToolDefinition,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmMessage,
  LlmProvider,
} from 'contracts';

export interface OpenAiCompatibleOptions {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAiCompatibleLlm(opts: OpenAiCompatibleOptions): LlmProvider {
  if (!opts.baseUrl) throw new Error('OpenAI-compatible LLM: baseUrl required');
  if (!opts.apiKey) throw new Error('OpenAI-compatible LLM: apiKey required');
  if (!opts.model) throw new Error('OpenAI-compatible LLM: model required');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const id = opts.id ?? `openai-compatible:${opts.model}`;
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    id,
    async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const body = {
        model: opts.model,
        messages: req.messages.map(toOpenAiMessage),
        tools: req.tools.map(toOpenAiTool),
        max_tokens: req.maxTokens ?? 1024,
      };
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        model?: string;
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };
      const msg = json.choices?.[0]?.message;
      const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        toolId: tc.function.name,
        arguments: parseArgs(tc.function.arguments),
      }));
      return {
        modelId: json.model ?? id,
        content: msg?.content ?? undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    },
  };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toOpenAiMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: m.toolCallId,
      content: m.content,
      name: m.name,
    };
  }
  return { role: m.role, content: m.content };
}

function toOpenAiTool(t: AipToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: t.toolId,
      description: t.description,
      parameters: t.inputSchema,
    },
  };
}
