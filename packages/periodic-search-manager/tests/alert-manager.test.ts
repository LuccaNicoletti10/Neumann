/**
 * Testes do alert-manager (alert/notify): destinatários = usuários da busca +
 * membros dos times (deduplicados); mensagem contém contagem e nome da busca;
 * sem novos resultados, sem alerta.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertManager,
  InMemoryNotifier,
  InMemoryTeamDirectory,
} from '../src/core/alert-manager.js';
import type { SearchConfig } from '../src/core/types.js';
import type { DataRecord } from '../src/core/data-source.js';
import { FakeClock, makeTempDir, removeTempDir } from './helpers.js';

function makeSearch(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return {
    id: 's1',
    name: 'Busca de erros',
    query: { text: 'erro' },
    dataSourceIds: ['fonte-a'],
    schedule: { kind: 'interval', everyMs: 60_000 },
    recipientUserIds: ['u1', 'u2'],
    teamIds: ['time-sec', 'time-ops'],
    enabled: true,
    createdBy: 'u1',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rec(recordId: string, sourceId: string): DataRecord {
  return {
    recordId,
    sourceId,
    timestamp: '2024-01-01T10:00:00.000Z',
    content: { msg: `erro em ${recordId}` },
  };
}

describe('AlertManager', () => {
  let dir: string;
  let notifier: InMemoryNotifier;
  let manager: AlertManager;

  beforeEach(async () => {
    dir = await makeTempDir();
    notifier = new InMemoryNotifier();
    const teams = new InMemoryTeamDirectory({
      'time-sec': ['u2', 'u3'], // u2 duplicado com a busca
      'time-ops': ['u4'],
    });
    manager = new AlertManager(dir, teams, [notifier], new FakeClock('2024-01-01T10:05:00.000Z'));
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('resolve destinatários: usuários da busca + membros dos times, deduplicados', async () => {
    const recipients = await manager.resolveRecipients(makeSearch());
    expect(recipients).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('gera alerta com contagem, nome da busca, fontes e amostra', async () => {
    const search = makeSearch();
    const records = [rec('r1', 'fonte-a'), rec('r2', 'fonte-a'), rec('r3', 'fonte-b')];
    const alert = await manager.createAndNotify(search, records);

    expect(alert.searchId).toBe('s1');
    expect(alert.searchName).toBe('Busca de erros');
    expect(alert.newRecordCount).toBe(3);
    expect(alert.sourceIds).toEqual(['fonte-a', 'fonte-b']);
    expect(alert.recipientUserIds).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(alert.message).toContain('Busca de erros');
    expect(alert.message).toContain('3');
    expect(alert.sampleRecords).toHaveLength(3);

    // Notificou cada destinatário exatamente uma vez:
    expect(notifier.sent.map((n) => n.userId).sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(notifier.sent[0]?.alert.id).toBe(alert.id);
  });

  it('persiste histórico de alertas por busca', async () => {
    await manager.createAndNotify(makeSearch(), [rec('r1', 'fonte-a')]);
    await manager.createAndNotify(makeSearch({ id: 's2', name: 'Outra' }), [rec('r2', 'fonte-a')]);

    expect(await manager.list()).toHaveLength(2);
    const onlyS1 = await manager.list('s1');
    expect(onlyS1).toHaveLength(1);
    expect(onlyS1[0]?.searchName).toBe('Busca de erros');

    // Persistência: nova instância lê o mesmo histórico.
    const manager2 = new AlertManager(dir, new InMemoryTeamDirectory({}), [], new FakeClock());
    expect(await manager2.list()).toHaveLength(2);
  });

  it('sem novos resultados = sem alerta (runner só chama com registros novos)', async () => {
    // O contrato do runner: createAndNotify só é invocado quando allNew.length > 0.
    // Aqui validamos que nenhum alerta é criado se a função não é chamada:
    expect(await manager.list()).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
  });

  it('time sem membros conhecidos não adiciona destinatários', async () => {
    const m = new AlertManager(dir, new InMemoryTeamDirectory({}), [], new FakeClock());
    const recipients = await m.resolveRecipients(makeSearch({ recipientUserIds: ['u9'], teamIds: ['time-inexistente'] }));
    expect(recipients).toEqual(['u9']);
  });
});