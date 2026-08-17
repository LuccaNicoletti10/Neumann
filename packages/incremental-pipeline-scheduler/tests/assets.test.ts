import { describe, expect, it } from 'vitest';

import {
  createAssetGraph,
  declareProduces,
  isStale,
  linkAssets,
  markStale,
  materialize,
} from '../src/core/assets.js';

describe('assets + staleness', () => {
  it('A→B→C chain and diamond', () => {
    const g = createAssetGraph();
    declareProduces(g, 't1', ['A']);
    linkAssets(g, 'A', 'B');
    linkAssets(g, 'B', 'C');
    expect(markStale(g, 'A')).toEqual(['B', 'C']);
    expect(isStale(g, 'B')).toBe(true);
    expect(isStale(g, 'C')).toBe(true);
    const down = materialize(g, 'B');
    expect(isStale(g, 'B')).toBe(false);
    expect(down).toEqual(['C']);

    const d = createAssetGraph();
    linkAssets(d, 'A', 'B');
    linkAssets(d, 'A', 'C');
    linkAssets(d, 'B', 'D');
    linkAssets(d, 'C', 'D');
    expect(markStale(d, 'A').sort()).toEqual(['B', 'C', 'D']);
  });
});
