/**
 * contracts — tests/pipeline-dag.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenPipelineEdge } from '../src/v1/pipeline-dag.js';

describe('Pipeline DAG contracts', () => {
  it('golden edge R1→D1', () => {
    const e = buildGoldenPipelineEdge();
    expect(e.sourceId).toBe('R1');
    expect(e.targetId).toBe('D1');
  });
});
