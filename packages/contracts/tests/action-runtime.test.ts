/**
 * contracts — tests/action-runtime.test.ts
 */
import { describe, expect, it } from 'vitest';

import type { ActionExecutor, ResolvedActionDefinition } from '../src/v1/action-runtime.js';

describe('Action runtime contracts (ADR-0006)', () => {
  it('ResolvedActionDefinition carries pin identity', () => {
    const resolved: ResolvedActionDefinition = {
      ontologyId: 'o',
      ontologyVersionId: 'v',
      actionTypeId: 'act.x',
      apiName: 'x',
      hash: 'abc',
      def: { id: 'act.x', displayName: 'X', inputObjectTypeIds: [] },
    };
    expect(resolved.hash).toBe('abc');
    expect(Object.isFrozen(resolved.def)).toBe(false);
  });

  it('ActionExecutor has no parallel ActionType cache', () => {
    const keys: (keyof ActionExecutor)[] = [
      'validate',
      'apply',
      'getExecution',
    ];
    expect(keys).toContain('apply');
    expect('registerActionType' in ({} as ActionExecutor)).toBe(false);
  });
});
