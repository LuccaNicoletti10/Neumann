/**
 * aip-gateway — Passo 36 propose → await approval (Action port).
 */
import { describe, expect, it } from 'vitest';

import type { AipActionPort, AipObjectReader, ActionApplyResult } from 'contracts';

import { createAiAgent } from '../src/core/agent.js';
import { createMockLlm } from '../src/adapters/mock-llm.js';
import { selectIdealExamples } from '../src/core/few-shot.js';
import { createToolRegistry, registerProposeTools } from '../src/core/tool-registry.js';

function reads(): AipObjectReader {
  return {
    async listObjectTypes() {
      return ['ot.item'];
    },
    async getObject() {
      return { objectTypeId: 'ot.item', primaryKey: 'A1', properties: { name: 'Widget' } };
    },
    async loadObjectSet() {
      return [{ objectTypeId: 'ot.item', primaryKey: 'A1', properties: { name: 'Widget' } }];
    },
    async graphNeighbors() {
      return [];
    },
  };
}

function mockActions(opts?: {
  applyStatus?: ActionApplyResult['status'];
}): { port: AipActionPort; applyCount: { n: number } } {
  const applyCount = { n: 0 };
  const port: AipActionPort = {
    async validate() {
      return { valid: true, errors: [], submissionCriteriaMet: true };
    },
    async apply(req) {
      applyCount.n += 1;
      return {
        executionId: 'aex-1',
        status: opts?.applyStatus ?? 'AWAITING_APPROVAL',
        actionTypeId: req.actionApiName,
      };
    },
  };
  return { port, applyCount };
}

describe('createAiAgent', () => {
  it('scripted propose pauses AWAITING_APPROVAL without LLM', async () => {
    const { port, applyCount } = mockActions();
    const agent = createAiAgent({
      reads: reads(),
      actions: port,
      llm: createMockLlm({ script: { kind: 'text', content: 'unused' } }),
      nextId: () => 'trace-agent',
    });
    const res = await agent.run({
      ontologyId: 'o1',
      principal: 'alice',
      message: 'Create item',
      proposedAction: {
        actionApiName: 'createItem',
        parameters: { id: 'A1' },
        idempotencyKey: 'k1',
      },
    });
    expect(applyCount.n).toBe(1);
    expect(res.finalState).toBe('AWAITING_APPROVAL');
    expect(res.proposedExecutionId).toBe('aex-1');
    expect(res.proposedActionStatus).toBe('AWAITING_APPROVAL');
    expect(res.toolsUsed).toEqual(expect.arrayContaining(['validate_action', 'propose_action']));
    expect(res.answer).toMatch(/awaits human approval/i);
  });

  it('scripted propose SUCCEEDED goes VERIFY→DONE', async () => {
    const { port } = mockActions({ applyStatus: 'SUCCEEDED' });
    const agent = createAiAgent({
      reads: reads(),
      actions: port,
      llm: createMockLlm({ script: { kind: 'text', content: 'unused' } }),
      nextId: () => 't',
    });
    const res = await agent.run({
      ontologyId: 'o1',
      principal: 'alice',
      message: 'Create',
      proposedAction: { actionApiName: 'createItem', parameters: { id: 'A1' } },
    });
    expect(res.finalState).toBe('DONE');
    expect(res.proposedActionStatus).toBe('SUCCEEDED');
  });

  it('invalid proposal → FAILED', async () => {
    const port: AipActionPort = {
      async validate() {
        return {
          valid: false,
          errors: [{ message: 'bad pk' }],
          submissionCriteriaMet: false,
        };
      },
      async apply() {
        throw new Error('should not apply');
      },
    };
    const agent = createAiAgent({
      reads: reads(),
      actions: port,
      llm: createMockLlm({ script: { kind: 'text', content: 'x' } }),
      nextId: () => 't',
    });
    const res = await agent.run({
      ontologyId: 'o1',
      principal: 'alice',
      message: 'Create',
      proposedAction: { actionApiName: 'createItem', parameters: {} },
    });
    expect(res.finalState).toBe('FAILED');
    expect(res.answer).toMatch(/bad pk/);
  });

  it('ask-mode registry still rejects propose tools', () => {
    const reg = createToolRegistry();
    expect(() => registerProposeTools(reg)).toThrow(/allowPropose/);
  });
});

describe('few-shot selector', () => {
  it('picks deterministic examples for similar input', () => {
    const picked = selectIdealExamples(
      [
        { id: '1', input: 'capital of France?', output: 'Paris' },
        { id: '2', input: 'capital of Germany?', output: 'Berlin' },
        { id: '3', input: '2+2?', output: '4' },
      ],
      'capital of Spain?',
      2,
    );
    expect(picked.length).toBe(2);
    expect(picked.every((p) => p.id)).toBe(true);
  });
});
