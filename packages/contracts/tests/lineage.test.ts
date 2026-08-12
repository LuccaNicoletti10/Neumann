/**
 * contracts — tests/lineage.test.ts
 */
import { describe, expect, it } from 'vitest';

import { assertPipelineRun, buildGoldenPipelineRun } from '../src/v1/lineage.js';

describe('Passo 15 contracts — lineage', () => {
  it('golden PipelineRun tem input_versions → output + hash + duration', () => {
    const run = buildGoldenPipelineRun();
    expect(run.inputVersions).toEqual(['ver-raw-1']);
    expect(run.outputVersion).toBe('ver-out-1');
    expect(run.contentHash).toHaveLength(64);
    expect(run.durationMs).toBe(42);
    expect(run.derivationProgramId).toBeTruthy();
    assertPipelineRun(run);
  });

  it('assertPipelineRun rejeita output sem hash', () => {
    const bad = { ...buildGoldenPipelineRun(), contentHash: '' };
    expect(() => assertPipelineRun(bad)).toThrow(/contentHash/);
  });
});
