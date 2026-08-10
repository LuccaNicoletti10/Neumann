/**
 * Testes do result-differ (new-data detection): registro repetido NÃO gera
 * alerta; registro com MESMO id e conteúdo ALTERADO (hash sha256 diferente)
 * gera.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultDiffer, hashContent } from '../src/core/result-differ.js';
import type { DataRecord } from '../src/core/data-source.js';
import { makeTempDir, removeTempDir } from './helpers.js';

function rec(recordId: string, content: Record<string, unknown>, ts = '2024-01-01T00:00:00.000Z'): DataRecord {
  return { recordId, sourceId: 'fonte-a', timestamp: ts, content };
}

describe('ResultDiffer', () => {
  let dir: string;
  let differ: ResultDiffer;

  beforeEach(async () => {
    dir = await makeTempDir();
    differ = new ResultDiffer(dir);
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('primeira execução: tudo é novo', async () => {
    const { newRecords, alreadySeenCount } = await differ.diff('s1', [rec('r1', { a: 1 })]);
    expect(newRecords).toHaveLength(1);
    expect(alreadySeenCount).toBe(0);
  });

  it('registro repetido (mesmo id + mesmo conteúdo) não é novo', async () => {
    await differ.markSeen('s1', [rec('r1', { a: 1 })]);
    const { newRecords, alreadySeenCount } = await differ.diff('s1', [rec('r1', { a: 1 })]);
    expect(newRecords).toHaveLength(0);
    expect(alreadySeenCount).toBe(1);
  });

  it('registro alterado (mesmo id, hash diferente) é novo', async () => {
    await differ.markSeen('s1', [rec('r1', { a: 1 })]);
    const { newRecords } = await differ.diff('s1', [rec('r1', { a: 2 })]);
    expect(newRecords).toHaveLength(1);
    expect(newRecords[0]?.recordId).toBe('r1');
  });

  it('versões antiga e nova do mesmo id podem coexistir no seen-set', async () => {
    await differ.markSeen('s1', [rec('r1', { a: 1 })]);
    await differ.markSeen('s1', [rec('r1', { a: 2 })]);
    const { newRecords, alreadySeenCount } = await differ.diff('s1', [
      rec('r1', { a: 1 }),
      rec('r1', { a: 2 }),
      rec('r1', { a: 3 }),
    ]);
    expect(newRecords).toHaveLength(1);
    expect(alreadySeenCount).toBe(2);
  });

  it('seen-set persiste entre instâncias (mesmo dataDir)', async () => {
    await differ.markSeen('s1', [rec('r1', { a: 1 })]);
    const differ2 = new ResultDiffer(dir);
    const { newRecords } = await differ2.diff('s1', [rec('r1', { a: 1 })]);
    expect(newRecords).toHaveLength(0);
  });

  it('hashContent é determinístico e estável a ordem de chaves', () => {
    const h1 = hashContent({ b: 2, a: 1 });
    const h2 = hashContent({ a: 1, b: 2 });
    const h3 = hashContent({ a: 1, b: 3 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});