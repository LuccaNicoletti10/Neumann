/**
 * aip-gateway — deterministic MockLlm for tests, demo, and eval (Passo 35–37).
 */

import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from 'contracts';

export type MockLlmScript =
  | { kind: 'text'; content: string }
  | {
      kind: 'tools';
      calls: Array<{ toolId: string; arguments: Record<string, unknown> }>;
      thenText: string;
    }
  | { kind: 'error'; message: string }
  | { kind: 'sequence'; steps: MockLlmScript[] };

type FlatStep =
  | { kind: 'text'; content: string }
  | {
      kind: 'tool_calls';
      calls: Array<{ toolId: string; arguments: Record<string, unknown> }>;
    }
  | { kind: 'error'; message: string };

/**
 * Scripted provider. `tools` expands to tool_calls then text.
 * `sequence` concatenates steps for multi-turn / adversarial harnesses.
 */
export function createMockLlm(opts: {
  id?: string;
  script: MockLlmScript;
}): LlmProvider {
  const id = opts.id ?? 'mock-llm';
  const flat = flattenScript(opts.script);
  let callIndex = 0;

  return {
    id,
    async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
      void req;
      const step = flat[Math.min(callIndex, Math.max(0, flat.length - 1))] ?? {
        kind: 'text' as const,
        content: '',
      };
      callIndex += 1;

      if (step.kind === 'error') {
        throw new Error(step.message);
      }
      if (step.kind === 'tool_calls') {
        return {
          modelId: id,
          toolCalls: step.calls.map((c, i) => ({
            id: `call-${i}`,
            toolId: c.toolId,
            arguments: c.arguments,
          })),
        };
      }
      return { modelId: id, content: step.content };
    },
  };
}

function flattenScript(script: MockLlmScript): FlatStep[] {
  if (script.kind === 'sequence') {
    return script.steps.flatMap(flattenScript);
  }
  if (script.kind === 'tools') {
    return [
      { kind: 'tool_calls', calls: script.calls },
      { kind: 'text', content: script.thenText },
    ];
  }
  if (script.kind === 'error') {
    return [{ kind: 'error', message: script.message }];
  }
  return [{ kind: 'text', content: script.content }];
}
