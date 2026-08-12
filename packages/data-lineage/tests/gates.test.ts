/**
 * data-lineage — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { hashCanonical } from '../src/core/hash.js';
import { createLineageStore } from '../src/core/store.js';
import { runDemo } from '../src/cli.js';

function store() {
  return createLineageStore({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 15 gates', () => {
  it('pipeline_run grava input_versions → output + hash + duration', () => {
    const s = store();
    s.registerRaw({
      versionId: 'a1',
      datasetId: 'a',
      datasetName: 'a',
      versionNumber: 1,
      contentHash: hashCanonical({ a: 1 }),
    });
    const run = s.recordRun({
      inputVersions: ['a1'],
      outputVersion: 'b1',
      datasetId: 'b',
      datasetName: 'b',
      versionNumber: 1,
      derivationProgramId: 't1',
      contentHash: hashCanonical({ b: 1 }),
      durationMs: 10,
    });
    expect(run.inputVersions).toEqual(['a1']);
    expect(run.outputVersion).toBe('b1');
    expect(run.contentHash).toHaveLength(64);
    expect(run.durationMs).toBe(10);
    expect(s.upstream('b1')).toEqual(['a1']);
    expect(s.downstream('a1')).toEqual(['b1']);
  });

  it('fullProvenance transitivo + visualize composto', () => {
    const s = store();
    s.registerRaw({
      versionId: 'r1',
      datasetId: 'raw',
      datasetName: 'raw',
      versionNumber: 1,
      contentHash: hashCanonical(1),
    });
    s.recordRun({
      inputVersions: ['r1'],
      outputVersion: 'm1',
      datasetId: 'mid',
      datasetName: 'mid',
      versionNumber: 1,
      derivationProgramId: 't-mid',
      contentHash: hashCanonical(2),
      durationMs: 1,
    });
    s.recordRun({
      inputVersions: ['m1'],
      outputVersion: 'o1',
      datasetId: 'out',
      datasetName: 'out',
      versionNumber: 1,
      derivationProgramId: 't-out',
      contentHash: hashCanonical(3),
      durationMs: 1,
    });

    const prov = s.fullProvenance('o1');
    expect(prov).toEqual(expect.arrayContaining(['m1', 'r1']));
    expect(prov).toHaveLength(2);

    const g = s.visualize('o1');
    expect(g.targetVersionId).toBe('o1');
    expect(g.nodes.length).toBe(3);
    expect(g.edges.length).toBe(2);
    expect(g.nodes.find((n) => n.datasetId === 'out')?.isTarget).toBe(true);
  });

  it('completude 100%: DERIVED sem input é orphan', () => {
    const s = store();
    s.registerRaw({
      versionId: 'r1',
      datasetId: 'raw',
      datasetName: 'raw',
      versionNumber: 1,
      contentHash: hashCanonical('r'),
    });
    s.recordRun({
      inputVersions: ['r1'],
      outputVersion: 'd1',
      datasetId: 'd',
      datasetName: 'd',
      versionNumber: 1,
      derivationProgramId: 't',
      contentHash: hashCanonical('d'),
      durationMs: 1,
    });
    expect(s.completeness().complete).toBe(true);
    expect(s.completeness().totalDerived).toBe(1);

    expect(() =>
      s.recordRun({
        inputVersions: [],
        outputVersion: 'bad',
        datasetId: 'x',
        datasetName: 'x',
        versionNumber: 1,
        derivationProgramId: 't',
        contentHash: hashCanonical('x'),
        durationMs: 1,
      }),
    ).toThrow(/inputVersions/);
  });

  it('invalid flag propaga downstream', () => {
    const s = store();
    s.registerRaw({
      versionId: 'r1',
      datasetId: 'raw',
      datasetName: 'raw',
      versionNumber: 1,
      contentHash: hashCanonical('r'),
    });
    s.recordRun({
      inputVersions: ['r1'],
      outputVersion: 'd1',
      datasetId: 'd',
      datasetName: 'd',
      versionNumber: 1,
      derivationProgramId: 't',
      contentHash: hashCanonical('d'),
      durationMs: 1,
    });
    s.flagInvalid('r1', 'bad source');
    const affected = s.propagateInvalid('r1');
    expect(affected).toEqual(['d1']);
    expect(s.getVersion('d1')?.invalid).toBe(true);
    expect(s.getVersion('d1')?.invalidReason).toContain('r1');
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
