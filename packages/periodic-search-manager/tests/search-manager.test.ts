/**
 * Teste e2e do SearchManager: periodic search + multiple data sources +
 * new-data detection (watermark + differ) + alert/notify + result storage.
 *
 * Fluxo: cria busca -> injeta dados em 2 fontes -> runNow -> 1 alerta com N
 * registros -> injeta mais dados só em 1 fonte -> runNow -> alerta só com os
 * novos -> runNow sem dados novos -> sem alerta. E persistência: recriar o
 * manager com o mesmo dataDir preserva watermarks/seen (não realerta).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SearchManager } from '../src/core/search-manager.js';
import { DataSourceRegistry, InMemoryDataSource } from '../src/core/data-source.js';
import { InMemoryNotifier, InMemoryTeamDirectory } from '../src/core/alert-manager.js';
import { FakeClock, makeTempDir, removeTempDir } from './helpers.js';

const T0 = '2024-01-01T00:00:00.000Z';

describe('SearchManager e2e', () => {
  let dir: string;
  let registry: DataSourceRegistry;
  let fonteA: InMemoryDataSource;
  let fonteB: InMemoryDataSource;
  let notifier: InMemoryNotifier;
  let clock: FakeClock;
  let manager: SearchManager;

  beforeEach(async () => {
    dir = await makeTempDir();
    registry = new DataSourceRegistry();
    fonteA = new InMemoryDataSource('fonte-a', 'Fonte A');
    fonteB = new InMemoryDataSource('fonte-b', 'Fonte B');
    registry.register(fonteA);
    registry.register(fonteB);
    notifier = new InMemoryNotifier();
    clock = new FakeClock(T0);
    manager = new SearchManager({
      dataDir: dir,
      registry,
      clock,
      notifiers: [notifier],
      teamDirectory: new InMemoryTeamDirectory({ 'time-sec': ['u2', 'u3'] }),
    });
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  async function criarBusca(): Promise<string> {
    const search = await manager.createSearch({
      name: 'Monitor de erros',
      query: { text: 'erro' },
      dataSourceIds: ['fonte-a', 'fonte-b'],
      schedule: { kind: 'interval', everyMs: 60_000 },
      recipientUserIds: ['u1'],
      teamIds: ['time-sec'],
    });
    return search.id;
  }

  it('fluxo completo: alertas só com dados novos', async () => {
    const id = await criarBusca();

    // Injete dados em 2 fontes (ambos casam com o texto "erro").
    fonteA.append([
      { recordId: 'a1', sourceId: 'fonte-a', timestamp: '2024-01-01T00:00:10.000Z', content: { msg: 'erro de disco' } },
      { recordId: 'a2', sourceId: 'fonte-a', timestamp: '2024-01-01T00:00:20.000Z', content: { msg: 'erro de rede' } },
      { recordId: 'a3', sourceId: 'fonte-a', timestamp: '2024-01-01T00:00:25.000Z', content: { msg: 'tudo ok' } }, // não casa
    ]);
    fonteB.append([
      { recordId: 'b1', sourceId: 'fonte-b', timestamp: '2024-01-01T00:00:15.000Z', content: { msg: 'erro de auth' } },
    ]);

    // 1ª execução -> 1 alerta com 3 registros novos (a3 filtrado pela query).
    const run1 = await manager.runNow(id);
    expect(run1.status).toBe('ok');
    expect(run1.totalFetched).toBe(3);
    expect(run1.totalNew).toBe(3);
    expect(run1.fetchedBySource).toEqual({ 'fonte-a': 2, 'fonte-b': 1 });

    const alerts1 = await manager.listAlerts(id);
    expect(alerts1).toHaveLength(1);
    expect(alerts1[0]?.newRecordCount).toBe(3);
    expect(alerts1[0]?.sourceIds).toEqual(['fonte-a', 'fonte-b']);
    expect(alerts1[0]?.recipientUserIds).toEqual(['u1', 'u2', 'u3']);
    expect(run1.alertId).toBe(alerts1[0]?.id);
    expect(notifier.sent).toHaveLength(3); // u1, u2, u3

    // Resultados persistidos (result storage):
    expect((await manager.listResults(id)).map((r) => r.recordId).sort()).toEqual(['a1', 'a2', 'b1']);
    // Watermarks avançaram por fonte:
    expect(await manager.watermarks.get(id, 'fonte-a')).toBe('2024-01-01T00:00:20.000Z');
    expect(await manager.watermarks.get(id, 'fonte-b')).toBe('2024-01-01T00:00:15.000Z');

    // Injete mais dados SÓ em 1 fonte:
    clock.advanceMs(1_000);
    fonteA.append([
      { recordId: 'a4', sourceId: 'fonte-a', timestamp: '2024-01-01T00:01:00.000Z', content: { msg: 'erro grave' } },
      // Registro com timestamp ANTIGO (< watermark): não deve aparecer.
      { recordId: 'a0', sourceId: 'fonte-a', timestamp: '2024-01-01T00:00:05.000Z', content: { msg: 'erro atrasado' } },
    ]);

    const run2 = await manager.runNow(id);
    expect(run2.totalFetched).toBe(1);
    expect(run2.totalNew).toBe(1);
    const alerts2 = await manager.listAlerts(id);
    expect(alerts2).toHaveLength(2);
    expect(alerts2[1]?.newRecordCount).toBe(1);
    expect(alerts2[1]?.sourceIds).toEqual(['fonte-a']);
    expect(alerts2[1]?.sampleRecords[0]?.recordId).toBe('a4');

    // Sem dados novos -> sem alerta:
    clock.advanceMs(1_000);
    const run3 = await manager.runNow(id);
    expect(run3.totalFetched).toBe(0);
    expect(run3.totalNew).toBe(0);
    expect(run3.alertId).toBeUndefined();
    expect(await manager.listAlerts(id)).toHaveLength(2);
    expect(notifier.sent).toHaveLength(6); // 2 alertas x 3 destinatários

    // Runs registrados:
    expect(await manager.listRuns(id)).toHaveLength(3);
  });

  it('registro alterado (mesmo id) gera novo alerta', async () => {
    const id = await criarBusca();
    fonteA.append([
      { recordId: 'a1', sourceId: 'fonte-a', timestamp: '2024-01-01T00:00:10.000Z', content: { msg: 'erro v1' } },
    ]);
    await manager.runNow(id);
    expect(await manager.listAlerts(id)).toHaveLength(1);

    // Mesmo recordId, conteúdo alterado, timestamp mais novo:
    fonteA.append([
      { recordId: 'a1', sourceId: 'fonte-a', timestamp: '2024-01-01T00:02:00.000Z', content: { msg: 'erro v2 alterado' } },
    ]);
    const run = await manager.runNow(id);
    expect(run.totalNew).toBe(1);
    const alerts = await manager.listAlerts(id);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]?.sampleRecords[0]?.preview).toContain('v2');
  });

  it('persistência: recriar o manager preserva watermarks/seen (não realerta)', async () => {
    const id = await criarBusca();
    fonteA.append([
      { recordId: 'a1', sourceId: 'fonte-a', timestamp: '2024-01-01T00:00:10.000Z', content: { msg: 'erro de disco' } },
    ]);
    await manager.runNow(id);
    expect(await manager.listAlerts(id)).toHaveLength(1);

    // Novo manager a partir do mesmo dataDir (mesma fonte, mesmo clock):
    const notifier2 = new InMemoryNotifier();
    const manager2 = new SearchManager({
      dataDir: dir,
      registry,
      clock,
      notifiers: [notifier2],
      teamDirectory: new InMemoryTeamDirectory({ 'time-sec': ['u2', 'u3'] }),
    });

    // A busca persistida existe e o watermark foi preservado:
    expect((await manager2.getSearch(id)).name).toBe('Monitor de erros');
    expect(await manager2.watermarks.get(id, 'fonte-a')).toBe('2024-01-01T00:00:10.000Z');

    // Rodar de novo sem dados novos: sem alerta, sem notificação.
    const run = await manager2.runNow(id);
    expect(run.totalNew).toBe(0);
    expect(notifier2.sent).toHaveLength(0);
    expect(await manager2.listAlerts(id)).toHaveLength(1); // histórico persistido

    // Dados novos chegam: o novo manager detecta normalmente.
    fonteA.append([
      { recordId: 'a2', sourceId: 'fonte-a', timestamp: '2024-01-01T00:03:00.000Z', content: { msg: 'erro novo' } },
    ]);
    const run2 = await manager2.runNow(id);
    expect(run2.totalNew).toBe(1);
    expect(await manager2.listAlerts(id)).toHaveLength(2);
    expect(notifier2.sent).toHaveLength(3);
  });

  it('tick do scheduler executa buscas vencidas e atualiza nextRunAt', async () => {
    const id = await criarBusca();
    const search = await manager.getSearch(id);
    expect(search.nextRunAt).toBe('2024-01-01T00:01:00.000Z'); // T0 + 60s

    // Ainda não venceu:
    expect(await manager.tick(clock.now())).toEqual([]);

    // Avança além do nextRunAt: executa.
    clock.advanceMs(61_000);
    const ran = await manager.tick(clock.now());
    expect(ran).toEqual([id]);
    const after = await manager.getSearch(id);
    expect(after.lastRunAt).toBe('2024-01-01T00:01:01.000Z');
    expect(after.nextRunAt).toBe('2024-01-01T00:02:01.000Z'); // schedule + finishedAt
  });

  it('createSearch rejeita fonte desconhecida e nome vazio', async () => {
    await expect(
      manager.createSearch({
        name: 'X',
        dataSourceIds: ['fonte-inexistente'],
        schedule: { kind: 'interval', everyMs: 1000 },
      }),
    ).rejects.toThrow(/fonte/i);
    await expect(
      manager.createSearch({
        name: '   ',
        dataSourceIds: ['fonte-a'],
        schedule: { kind: 'interval', everyMs: 1000 },
      }),
    ).rejects.toThrow(/nome/i);
  });

  it('CRUD: update/delete/get/list', async () => {
    const id = await criarBusca();
    const updated = await manager.updateSearch(id, { name: 'Renomeada', enabled: false });
    expect(updated.name).toBe('Renomeada');
    expect(updated.enabled).toBe(false);
    expect(await manager.listSearches()).toHaveLength(1);
    expect(await manager.deleteSearch(id)).toBe(true);
    expect(await manager.deleteSearch(id)).toBe(false);
    expect(await manager.listSearches()).toHaveLength(0);
    await expect(manager.getSearch(id)).rejects.toThrow(/não encontrada/i);
  });
});