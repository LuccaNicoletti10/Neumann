/**
 * incremental-pipeline-scheduler — tests/gates.test.ts
 * Gate Passo 12: mudar 1 input → só outputs dependentes.
 */
import { describe, expect, it } from 'vitest';

import { CycleError } from '../src/core/dag.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { seedPatentFigure2b } from '../src/core/fixture.js';
import { createIncrementalPipelineScheduler } from '../src/core/scheduler.js';
import { runDemo } from '../src/cli.js';

function sched() {
  return createIncrementalPipelineScheduler({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 12 gates', () => {
  it('R1 → só D1; R2 → nada', () => {
    const s = sched();
    seedPatentFigure2b(s);
    const a = s.commitArrival('R1', 1);
    expect(a.rebuiltDatasetIds).toEqual(['D1']);
    expect(a.partialDependencyIds).toEqual(expect.arrayContaining(['D4', 'D6']));

    const b = s.commitArrival('R2', 2);
    expect(b.rebuiltDatasetIds).toEqual([]);
    expect(b.dependentIds).toEqual([]);
  });

  it('R3 completa D2+D4; R4 completa D3+D5+D6', () => {
    const s = sched();
    seedPatentFigure2b(s);
    s.commitArrival('R1');
    const r3 = s.commitArrival('R3');
    expect(r3.rebuiltDatasetIds).toEqual(['D2', 'D4']);

    const r4 = s.commitArrival('R4');
    expect(r4.rebuiltDatasetIds).toEqual(['D3', 'D5', 'D6']);
    expect(s.getDataset('D6')?.buildStatus).toBe('COMPLETED');
  });

  it('detecta ciclo', () => {
    const s = sched();
    seedPatentFigure2b(s);
    expect(() => s.addEdge({ sourceId: 'D6', targetId: 'R1' })).toThrow(CycleError);
  });

  it('cutoff full build dos restantes', () => {
    const s = sched();
    seedPatentFigure2b(s);
    s.markCritical('D6');
    s.commitArrival('R1');
    // D2/D3 ainda faltam → D6 critical missing
    const cut = s.runCutoffFullBuild();
    expect(cut.criticalMissing).toContain('D6');
    // só D1 já built; nada mais buildável
    expect(cut.rebuiltDatasetIds).toEqual([]);

    s.commitArrival('R3');
    s.commitArrival('R4');
    expect(s.hasArrived('D6')).toBe(true);
  });

  it('rebuild determinístico: mesmo payload → mesmo hash', () => {
    const s1 = sched();
    const s2 = sched();
    seedPatentFigure2b(s1);
    seedPatentFigure2b(s2);
    s1.commitArrival('R1', { x: 1 });
    s2.commitArrival('R1', { x: 1 });
    expect(s1.getDataset('D1')?.contentHash).toBe(s2.getDataset('D1')?.contentHash);
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
