/**
 * function-registry — tests/gates.test.ts
 * Gate: function pura, versionada, invocável.
 */
import { describe, expect, it } from 'vitest';

import type { FunctionObjectInput } from 'contracts';

import { runDemo } from '../src/cli.js';
import { createFunctionRegistry } from '../src/core/registry.js';

const objects: FunctionObjectInput[] = [
  { objectTypeId: 'ot.customer', primaryKey: 'A', properties: { name: 'ACME', amount: 80 } },
  { objectTypeId: 'ot.customer', primaryKey: 'B', properties: { name: '', amount: 20 } },
];

describe('Passo 23 — function registry', () => {
  it('builtins scoreRecord / aggregateMetrics / deriveFlags', () => {
    const fn = createFunctionRegistry();
    const names = fn.list().map((d) => d.apiName).sort();
    expect(names).toEqual(['aggregateMetrics', 'deriveFlags', 'scoreRecord']);

    const scored = fn.invoke({ functionId: 'scoreRecord', objects });
    const scores = (scored.result as { scores: Array<{ score: number }> }).scores;
    expect(scores).toHaveLength(2);
    expect(scores[0]!.score).toBeGreaterThan(scores[1]!.score);

    const metrics = fn.invoke({
      functionId: 'fn.aggregateMetrics',
      objects,
      params: { property: 'amount' },
    });
    expect(metrics.result).toMatchObject({ count: 2, sum: 100, min: 20, max: 80 });

    const flags = fn.invoke({
      functionId: 'deriveFlags',
      objects,
      params: { threshold: 50 },
    });
    const rows = (flags.result as { flags: Array<{ aboveThreshold: boolean }> }).flags;
    expect(rows[0]!.aboveThreshold).toBe(true);
    expect(rows[1]!.aboveThreshold).toBe(false);
  });

  it('versão é imutável; v1 continua invocável após v2', () => {
    const fn = createFunctionRegistry();
    fn.register(
      {
        id: 'fn.scoreRecord',
        apiName: 'scoreRecord',
        displayName: 'scoreRecord',
        version: '2',
        inputObjectTypeIds: ['ot.customer', 'ot.record', 'ot.entity'],
        outputKind: 'score',
      },
      () => ({ scores: [{ score: 0 }] }),
    );
    expect(() =>
      fn.register(
        {
          id: 'fn.scoreRecord',
          apiName: 'scoreRecord',
          displayName: 'scoreRecord',
          version: '1',
          inputObjectTypeIds: ['ot.customer'],
          outputKind: 'score',
        },
        () => ({ scores: [] }),
      ),
    ).toThrow(/imutável/);

    const v1 = fn.invoke({ functionId: 'scoreRecord', version: '1', objects });
    const latest = fn.invoke({ functionId: 'scoreRecord', objects });
    expect(v1.version).toBe('1');
    expect(latest.version).toBe('2');
    expect((v1.result as { scores: Array<{ score: number }> }).scores[0]!.score).not.toBe(0);
    expect((latest.result as { scores: Array<{ score: number }> }).scores[0]!.score).toBe(0);
    expect(fn.listVersions('scoreRecord').map((d) => d.version)).toEqual(['1', '2']);
  });

  it('rejeita impl que muta objects', () => {
    const fn = createFunctionRegistry({ builtins: false });
    fn.register(
      {
        id: 'fn.bad',
        apiName: 'bad',
        displayName: 'bad',
        version: '1',
        inputObjectTypeIds: ['ot.customer'],
        outputKind: 'json',
      },
      (objs) => {
        const first = objs[0];
        if (first) first.properties.x = 1;
        return { ok: true };
      },
    );
    const input = structuredClone(objects);
    expect(() => fn.invoke({ functionId: 'bad', objects: input })).toThrow(/pura|mutação/);
    expect(input[0]!.properties.x).toBeUndefined();
  });

  it('rejeita objectType fora do contrato', () => {
    const fn = createFunctionRegistry();
    expect(() =>
      fn.invoke({
        functionId: 'scoreRecord',
        objects: [{ objectTypeId: 'ot.unknown', properties: {} }],
      }),
    ).toThrow(/objectType/);
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('function pura, versionada'))).toBe(true);
  });
});
