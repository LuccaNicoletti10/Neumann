/**
 * history-preserving-pipeline — tests/gates.test.ts
 * Gates Passo 8: imutabilidade, duplicate commit, lineage fields, build, trace.
 */
import { describe, expect, it } from 'vitest';

import { ManifestError } from '../src/core/manifest.js';
import { TransactionError } from '../src/core/transaction.js';
import { createTestPipeline } from './helpers.js';

describe('Passo 8 gates', () => {
  it('versão COMMITTED rejeita update/delete', () => {
    const pipe = createTestPipeline();
    const ds = pipe.createDataset({ name: 'a' });
    const tx = pipe.startTransaction(ds.id);
    pipe.writeTransaction(tx.id, { x: 1 });
    const v = pipe.commitTransaction(tx.id);

    expect(() => pipe.manifest.updateVersion(v.id, { contentHash: 'nope' })).toThrow(
      ManifestError,
    );
    expect(() => pipe.manifest.deleteVersion(v.id)).toThrow(/imutável/);
  });

  it('write após commit falha', () => {
    const pipe = createTestPipeline();
    const ds = pipe.createDataset({ name: 'a' });
    const tx = pipe.startTransaction(ds.id);
    pipe.writeTransaction(tx.id, { x: 1 });
    pipe.commitTransaction(tx.id);
    expect(() => pipe.writeTransaction(tx.id, { x: 2 })).toThrow(TransactionError);
  });

  it('dois commits com o mesmo contentHash → mesma versionId', () => {
    const pipe = createTestPipeline();
    const ds = pipe.createDataset({ name: 'a' });
    const payload = { rows: [1, 2, 3] };

    const tx1 = pipe.startTransaction(ds.id);
    pipe.writeTransaction(tx1.id, payload);
    const v1 = pipe.commitTransaction(tx1.id);

    const tx2 = pipe.startTransaction(ds.id, { parentVersion: v1.id });
    pipe.writeTransaction(tx2.id, payload);
    const v2 = pipe.commitTransaction(tx2.id);

    expect(v2.id).toBe(v1.id);
    expect(pipe.listVersions(ds.id)).toHaveLength(1);
  });

  it('commit persiste parentVersion + inputVersions + transformationId + policyId/lineageRef', () => {
    const pipe = createTestPipeline();
    const src = pipe.createDataset({ name: 'src' });
    const out = pipe.createDataset({ name: 'out' });

    const txSrc = pipe.startTransaction(src.id);
    pipe.writeTransaction(txSrc.id, { v: 1 });
    const srcV = pipe.commitTransaction(txSrc.id);

    const tx = pipe.startTransaction(out.id, {
      inputVersions: [srcV.id],
      transformationId: 'transform-x',
      schemaVersion: '2',
      policyId: null,
      lineageRef: null,
    });
    pipe.writeTransaction(tx.id, { derived: true });
    const outV = pipe.commitTransaction(tx.id);

    expect(outV.inputVersions).toEqual([srcV.id]);
    expect(outV.transformationId).toBe('transform-x');
    expect(outV.schemaVersion).toBe('2');
    expect(outV.policyId).toBeNull();
    expect(outV.lineageRef).toBeNull();
    expect(outV.status).toBe('COMMITTED');
  });

  it('build: dependência muda → isOutOfDate → rebuild sobe versão e catalog', () => {
    const pipe = createTestPipeline();
    const raw = pipe.createDataset({ name: 'raw' });
    const agg = pipe.createDataset({ name: 'agg' });

    const tx = pipe.startTransaction(raw.id);
    pipe.writeTransaction(tx.id, { n: 1 });
    pipe.commitTransaction(tx.id);

    const prog = pipe.registerProgram(
      {
        name: 'inc',
        inputDatasetIds: [raw.id],
        outputDatasetId: agg.id,
        schemaVersion: '1',
      },
      (inputs) => {
        const p = inputs[0] as { n: number };
        return { n: p.n * 10 };
      },
    );

    expect(pipe.isOutOfDate(prog.id)).toBe(true);
    const b1 = pipe.buildDataset(prog.id);
    expect(pipe.isOutOfDate(prog.id)).toBe(false);
    expect(pipe.build.listCatalog()).toHaveLength(1);

    const tx2 = pipe.startTransaction(raw.id);
    pipe.writeTransaction(tx2.id, { n: 2 });
    pipe.commitTransaction(tx2.id);
    expect(pipe.isOutOfDate(prog.id)).toBe(true);

    pipe.build.enqueueDependents(raw.id);
    const rebuilt = pipe.processQueue();
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]!.versionNumber).toBeGreaterThan(b1.versionNumber);
    expect(pipe.build.listCatalog()).toHaveLength(2);
    expect(pipe.isOutOfDate(prog.id)).toBe(false);
  });

  it('traceDatasetHistory percorre dependências', () => {
    const pipe = createTestPipeline();
    const raw = pipe.createDataset({ name: 'raw' });
    const agg = pipe.createDataset({ name: 'agg' });

    const tx = pipe.startTransaction(raw.id);
    pipe.writeTransaction(tx.id, { n: 5 });
    const rawV = pipe.commitTransaction(tx.id);

    const prog = pipe.registerProgram(
      {
        name: 'x',
        inputDatasetIds: [raw.id],
        outputDatasetId: agg.id,
        schemaVersion: '1',
      },
      (inputs) => ({ out: (inputs[0] as { n: number }).n }),
    );
    const built = pipe.buildDataset(prog.id);
    const trace = pipe.traceDatasetHistory(built.id);

    expect(trace.versionId).toBe(built.id);
    expect(trace.transformationId).toBe(prog.id);
    expect(trace.children.some((c) => c.versionId === rawV.id)).toBe(true);
  });

  it('compareVersions reporta diff estrutural', () => {
    const pipe = createTestPipeline();
    const ds = pipe.createDataset({ name: 'd' });
    const t1 = pipe.startTransaction(ds.id);
    pipe.writeTransaction(t1.id, { a: 1, b: 2 });
    const v1 = pipe.commitTransaction(t1.id);
    const t2 = pipe.startTransaction(ds.id);
    pipe.writeTransaction(t2.id, { a: 1, b: 3, c: 4 });
    const v2 = pipe.commitTransaction(t2.id);

    const diff = pipe.compareVersions(v1.id, v2.id);
    expect(diff.sameContent).toBe(false);
    expect(diff.changedKeys).toContain('b');
    expect(diff.addedKeys).toContain('c');
  });
});
