/**
 * aip-gateway — unit tests (Passo 35).
 */
import { describe, expect, it } from 'vitest';

import type { AipObjectReader } from 'contracts';

import { createAiGateway } from '../src/core/gateway.js';
import { createMockLlm } from '../src/adapters/mock-llm.js';
import { createOpenAiCompatibleLlm } from '../src/adapters/openai-compatible.js';
import { createToolRegistry, registerDefaultReadTools } from '../src/core/tool-registry.js';
import { filterAipOutput } from '../src/core/output-filter.js';

function memoryReads(opts?: { secret?: string }): AipObjectReader {
  const secret = opts?.secret ?? 'TOP-SECRET-COST';
  return {
    async listObjectTypes() {
      return ['ot.item'];
    },
    async getObject(principal, _o, objectTypeId, primaryKey) {
      if (objectTypeId !== 'ot.item' || primaryKey !== 'A1') return undefined;
      const properties: Record<string, unknown> = { name: 'Widget' };
      if (principal === 'admin') properties.unitCost = secret;
      return { objectTypeId, primaryKey, properties };
    },
    async loadObjectSet(principal, ontologyId, objectTypeId, limit) {
      const one = await this.getObject(principal, ontologyId, objectTypeId, 'A1');
      return one ? [one].slice(0, limit) : [];
    },
    async graphNeighbors() {
      return [];
    },
  };
}

describe('createAiGateway', () => {
  it('grounds an answer with citations from tool results', async () => {
    const gateway = createAiGateway({
      reads: memoryReads(),
      llm: createMockLlm({
        script: {
          kind: 'tools',
          calls: [
            {
              toolId: 'get_object',
              arguments: { objectTypeId: 'ot.item', primaryKey: 'A1' },
            },
          ],
          thenText: 'A1 is Widget.',
        },
      }),
      nextId: () => 'trace-1',
    });
    const res = await gateway.ask({
      ontologyId: 'o1',
      principal: 'sales',
      message: 'Describe A1',
    });
    expect(res.answer).toMatch(/Widget/);
    expect(res.citations).toEqual([
      { ontologyId: 'o1', objectTypeId: 'ot.item', primaryKey: 'A1' },
    ]);
    expect(res.toolsUsed).toContain('get_object');
    expect(res.traceId).toBe('trace-1');
  });

  it('refuses non-read tool registration', () => {
    const reg = createToolRegistry();
    expect(() =>
      reg.register(
        {
          toolId: 'mutate',
          description: 'bad',
          inputSchema: {},
          outputSchema: {},
          requiredPermission: 'write',
          riskLevel: 'read',
          timeoutMs: 1,
        },
        async () => null,
      ),
    ).not.toThrow();
    expect(() =>
      reg.register(
        {
          toolId: 'boom',
          description: 'bad',
          inputSchema: {},
          outputSchema: {},
          requiredPermission: 'write',
          // @ts-expect-error intentional illegal risk
          riskLevel: 'write',
          timeoutMs: 1,
        },
        async () => null,
      ),
    ).toThrow(/unsupported riskLevel|only riskLevel/);

    expect(() =>
      createToolRegistry().register(
        {
          toolId: 'propose_sneak',
          description: 'bad',
          inputSchema: {},
          outputSchema: {},
          requiredPermission: 'x',
          riskLevel: 'propose',
          timeoutMs: 1,
        },
        async () => null,
      ),
    ).toThrow(/allowPropose/);
  });
});

describe('output filter', () => {
  it('strips forbidden substrings and secrets', () => {
    const out = filterAipOutput({
      answer: 'cost is TOP-SECRET-COST Bearer abc.token.here',
      allowedCitations: [{ ontologyId: 'o', objectTypeId: 'ot.item', primaryKey: 'A1' }],
      forbiddenSubstrings: ['TOP-SECRET-COST'],
    });
    expect(out.answer).not.toContain('TOP-SECRET-COST');
    expect(out.answer).toContain('[REDACTED]');
  });
});

describe('redaction (sales vs admin)', () => {
  it('sales getObject omits unitCost; ask path never surfaces the field', async () => {
    const secret = 'TOP-SECRET-COST';
    const reads = memoryReads({ secret });
    const salesObj = await reads.getObject('sales', 'o1', 'ot.item', 'A1');
    expect(salesObj?.properties.unitCost).toBeUndefined();
    const adminObj = await reads.getObject('admin', 'o1', 'ot.item', 'A1');
    expect(adminObj?.properties.unitCost).toBe(secret);

    const gateway = createAiGateway({
      reads,
      llm: createMockLlm({
        script: {
          kind: 'tools',
          calls: [
            {
              toolId: 'get_object',
              arguments: { objectTypeId: 'ot.item', primaryKey: 'A1' },
            },
          ],
          thenText: 'A1 is Widget.',
        },
      }),
      nextId: () => 'trace-redact',
    });
    const res = await gateway.ask({
      ontologyId: 'o1',
      principal: 'sales',
      message: 'Describe A1',
    });
    const blob = JSON.stringify(res);
    expect(blob).not.toContain('unitCost');
    expect(blob).not.toContain(secret);
    expect(res.citations[0]?.primaryKey).toBe('A1');
  });
});

describe('LLM swap', () => {
  it('Mock and OpenAI-compatible fake yield the same citations', async () => {
    const reads = memoryReads();
    const scriptCalls = [
      {
        toolId: 'get_object' as const,
        arguments: { objectTypeId: 'ot.item', primaryKey: 'A1' },
      },
    ];

    const mockGw = createAiGateway({
      reads,
      llm: createMockLlm({
        script: { kind: 'tools', calls: scriptCalls, thenText: 'A1 Widget' },
      }),
      nextId: () => 't',
    });

    let round = 0;
    const fakeFetch: typeof fetch = async () => {
      round += 1;
      if (round === 1) {
        return new Response(
          JSON.stringify({
            model: 'fake-1',
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'c1',
                      function: {
                        name: 'get_object',
                        arguments: JSON.stringify({
                          objectTypeId: 'ot.item',
                          primaryKey: 'A1',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          model: 'fake-1',
          choices: [{ message: { content: 'A1 Widget' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const openAiGw = createAiGateway({
      reads,
      llm: createOpenAiCompatibleLlm({
        baseUrl: 'http://llm.test/v1',
        apiKey: 'test-key',
        model: 'fake-1',
        fetchImpl: fakeFetch,
      }),
      nextId: () => 't',
    });

    const a = await mockGw.ask({
      ontologyId: 'o1',
      principal: 'sales',
      message: 'A1?',
    });
    const b = await openAiGw.ask({
      ontologyId: 'o1',
      principal: 'sales',
      message: 'A1?',
    });
    expect(a.citations).toEqual(b.citations);
    expect(a.toolsUsed).toEqual(b.toolsUsed);
  });
});

describe('default tools', () => {
  it('registerDefaultReadTools exposes four read tools', () => {
    const reg = createToolRegistry();
    registerDefaultReadTools(reg);
    expect(reg.list().map((t) => t.toolId).sort()).toEqual([
      'get_object',
      'graph_neighbors',
      'list_object_types',
      'load_object_set',
    ]);
  });
});
