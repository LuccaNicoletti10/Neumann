/**
 * contracts — AIP ask request assertion (Passo 35).
 */
import { describe, expect, it } from 'vitest';

import { assertAipAgentRunRequest, assertAipAskRequest } from '../src/v1/aip.js';

describe('assertAipAskRequest', () => {
  it('accepts a minimal valid request', () => {
    expect(
      assertAipAskRequest({
        ontologyId: 'o1',
        message: 'hello',
        principal: 'alice',
      }),
    ).toEqual({ ontologyId: 'o1', message: 'hello', principal: 'alice' });
  });

  it('rejects missing fields', () => {
    expect(() => assertAipAskRequest({})).toThrow(/ontologyId/);
    expect(() =>
      assertAipAskRequest({ ontologyId: 'o1', message: 'x' }),
    ).toThrow(/principal/);
  });

  it('rejects oversized message', () => {
    expect(() =>
      assertAipAskRequest({
        ontologyId: 'o1',
        principal: 'a',
        message: 'x'.repeat(8_001),
      }),
    ).toThrow(/too long/);
  });
});

describe('assertAipAgentRunRequest', () => {
  it('accepts proposedAction', () => {
    expect(
      assertAipAgentRunRequest({
        ontologyId: 'o1',
        message: 'go',
        principal: 'alice',
        proposedAction: { actionApiName: 'createItem', parameters: { id: '1' } },
      }).proposedAction?.actionApiName,
    ).toBe('createItem');
  });

  it('rejects proposedAction without api name', () => {
    expect(() =>
      assertAipAgentRunRequest({
        ontologyId: 'o1',
        message: 'go',
        principal: 'alice',
        proposedAction: { parameters: {} },
      }),
    ).toThrow(/actionApiName/);
  });
});
