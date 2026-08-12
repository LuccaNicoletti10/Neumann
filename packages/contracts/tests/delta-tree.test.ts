/**
 * contracts — tests/delta-tree.test.ts
 * Golden fixture Passo 9.
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenDeltaOps } from '../src/v1/delta-tree.js';

describe('Delta tree contracts', () => {
  it('golden DeltaOp cobre update/add', () => {
    const ops = buildGoldenDeltaOps();
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ type: 'update', path: 'age', value: 31 });
    expect(ops[1]).toEqual({ type: 'add', key: 'city', value: 'SF' });
  });
});
