/**
 * Testes do watermark (new-data detection): em execuções subsequentes, apenas
 * registros NOVOS (timestamp > high-watermark por busca/fonte) são retornados.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WatermarkStore } from '../src/core/watermark-store.js';
import { InMemoryDataSource } from '../src/core/data-source.js';
import { makeTempDir, removeTempDir } from './helpers.js';

describe('WatermarkStore', () => {
  let dir: string;
  let store: WatermarkStore;

  beforeEach(async () => {
    dir = await makeTempDir();
    store = new WatermarkStore(dir);
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('retorna undefined quando a busca/fonte nunca rodou', async () => {
    expect(await store.get('s1', 'fonte-a')).toBeUndefined();
  });

  it('persiste e recupera watermark por (searchId, sourceId)', async () => {
    await store.set('s1', 'fonte-a', '2024-01-01T10:00:00.000Z');
    await store.set('s1', 'fonte-b', '2024-01-01T09:00:00.000Z');
    expect(await store.get('s1', 'fonte-a')).toBe('2024-01-01T10:00:00.000Z');
    expect(await store.get('s1', 'fonte-b')).toBe('2024-01-01T09:00:00.000Z');
    // (searchId, sourceId) são independentes:
    expect(await store.get('s2', 'fonte-a')).toBeUndefined();
  });

  it('sobrevive à recriação a partir do mesmo dataDir (persistência JSON)', async () => {
    await store.set('s1', 'fonte-a', '2024-01-01T10:00:00.000Z');
    const store2 = new WatermarkStore(dir);
    expect(await store2.get('s1', 'fonte-a')).toBe('2024-01-01T10:00:00.000Z');
  });

  it('só registros novos são retornados pela fonte quando since=watermark', async () => {
    const source = new InMemoryDataSource('fonte-a', 'Fonte A', [
      { recordId: 'r1', sourceId: 'fonte-a', timestamp: '2024-01-01T08:00:00.000Z', content: { msg: 'antigo' } },
      { recordId: 'r2', sourceId: 'fonte-a', timestamp: '2024-01-01T10:00:00.000Z', content: { msg: 'meio' } },
    ]);

    // 1ª execução: sem watermark -> tudo.
    let since = await store.get('search-1', 'fonte-a');
    const firstRun = await source.query({}, since);
    expect(firstRun.map((r) => r.recordId)).toEqual(['r1', 'r2']);
    await store.set('search-1', 'fonte-a', '2024-01-01T10:00:00.000Z');

    // Entre execuções chegam dados novos:
    source.append([
      { recordId: 'r3', sourceId: 'fonte-a', timestamp: '2024-01-01T12:00:00.000Z', content: { msg: 'novo' } },
    ]);

    // 2ª execução: só o registro novo retorna.
    since = await store.get('search-1', 'fonte-a');
    const secondRun = await source.query({}, since);
    expect(secondRun.map((r) => r.recordId)).toEqual(['r3']);
  });
});