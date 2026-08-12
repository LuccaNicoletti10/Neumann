/**
 * delta-storage — tests/apply.test.ts
 */
import { describe, expect, it } from 'vitest';

import { applyOps, diffStates } from '../src/core/apply.js';

describe('apply / diff', () => {
  it('update/delete/add round-trip', () => {
    const base = { a: 1, nested: { x: 1 }, keep: true };
    const ops = [
      { type: 'update' as const, path: 'a', value: 2 },
      { type: 'update' as const, path: 'nested.x', value: 9 },
      { type: 'add' as const, key: 'b', value: 'new' },
      { type: 'delete' as const, path: 'keep' },
    ];
    const next = applyOps(base, ops);
    expect(next).toEqual({ a: 2, nested: { x: 9 }, b: 'new' });
    expect(base).toEqual({ a: 1, nested: { x: 1 }, keep: true });
  });

  it('diffStates gera ops equivalentes', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 3, c: 4 };
    const ops = diffStates(before, after);
    expect(applyOps(before, ops)).toEqual(after);
  });
});
