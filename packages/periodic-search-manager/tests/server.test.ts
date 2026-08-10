/**
 * Teste do servidor HTTP (Fastify): boot + fluxo completo via HTTP — criar
 * fonte, criar busca, injetar registro, executar e listar alertas/resultados.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/server/index.js';
import { InMemoryNotifier, InMemoryTeamDirectory } from '../src/core/alert-manager.js';
import { makeTempDir, removeTempDir, FakeClock } from './helpers.js';

describe('Servidor HTTP', () => {
  let dir: string;
  let app: FastifyInstance;
  let notifier: InMemoryNotifier;

  beforeEach(async () => {
    dir = await makeTempDir();
    notifier = new InMemoryNotifier();
    const built = await createApp({
      dataDir: dir,
      notifiers: [notifier],
      teamDirectory: new InMemoryTeamDirectory({ 'time-sec': ['u2'] }),
      clock: new FakeClock('2024-01-01T00:00:00.000Z'),
    });
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
    await removeTempDir(dir);
  });

  it('GET /health responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('fluxo completo: source -> search -> inject -> run -> alerts/results', async () => {
    // 1. Registrar fonte em memória:
    const resSource = await app.inject({
      method: 'POST',
      url: '/sources',
      payload: { kind: 'memory', id: 's1', name: 'Logs' },
    });
    expect(resSource.statusCode).toBe(201);

    const resSources = await app.inject({ method: 'GET', url: '/sources' });
    expect(resSources.json()).toEqual([{ id: 's1', name: 'Logs', kind: 'memory' }]);

    // 2. Criar busca periódica:
    const resSearch = await app.inject({
      method: 'POST',
      url: '/searches',
      payload: {
        name: 'Monitor de erros',
        query: { text: 'erro' },
        dataSourceIds: ['s1'],
        schedule: { kind: 'interval', everyMs: 60_000 },
        recipientUserIds: ['u1'],
        teamIds: ['time-sec'],
      },
    });
    expect(resSearch.statusCode).toBe(201);
    const search = resSearch.json() as { id: string };
    expect(search.id).toBeTruthy();

    // 3. Injetar registro novo:
    const resRec = await app.inject({
      method: 'POST',
      url: '/sources/s1/records',
      payload: {
        recordId: 'r1',
        timestamp: '2024-01-01T00:00:10.000Z',
        content: { msg: 'erro de disco' },
      },
    });
    expect(resRec.statusCode).toBe(201);

    // 4. Executar a busca:
    const resRun = await app.inject({ method: 'POST', url: `/searches/${search.id}/run` });
    expect(resRun.statusCode).toBe(200);
    const run = resRun.json() as { totalNew: number; alertId?: string };
    expect(run.totalNew).toBe(1);
    expect(run.alertId).toBeTruthy();

    // 5. Alertas: 1 alerta com destinatários u1 + u2 (time-sec):
    const resAlerts = await app.inject({ method: 'GET', url: `/searches/${search.id}/alerts` });
    const alerts = resAlerts.json() as Array<{ newRecordCount: number; recipientUserIds: string[] }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.newRecordCount).toBe(1);
    expect(alerts[0]?.recipientUserIds).toEqual(['u1', 'u2']);

    // 6. Resultados persistidos:
    const resResults = await app.inject({ method: 'GET', url: `/searches/${search.id}/results` });
    expect((resResults.json() as unknown[]).length).toBe(1);

    // 7. Runs:
    const resRuns = await app.inject({ method: 'GET', url: `/searches/${search.id}/runs` });
    expect((resRuns.json() as unknown[]).length).toBe(1);

    // 8. Rodar de novo sem dados novos -> sem alerta novo:
    const resRun2 = await app.inject({ method: 'POST', url: `/searches/${search.id}/run` });
    expect((resRun2.json() as { totalNew: number }).totalNew).toBe(0);
    const resAlerts2 = await app.inject({ method: 'GET', url: `/searches/${search.id}/alerts` });
    expect((resAlerts2.json() as unknown[]).length).toBe(1);
  });

  it('validações e erros 404/400', async () => {
    // Body inválido:
    const bad = await app.inject({ method: 'POST', url: '/searches', payload: { name: '' } });
    expect(bad.statusCode).toBe(400);

    // Busca inexistente:
    const notFound = await app.inject({ method: 'GET', url: '/searches/nao-existe' });
    expect(notFound.statusCode).toBe(404);
    const runMissing = await app.inject({ method: 'POST', url: '/searches/nao-existe/run' });
    expect(runMissing.statusCode).toBe(404);
    const delMissing = await app.inject({ method: 'DELETE', url: '/searches/nao-existe' });
    expect(delMissing.statusCode).toBe(404);

    // Injetar registro em fonte inexistente:
    const noSource = await app.inject({
      method: 'POST',
      url: '/sources/xyz/records',
      payload: { recordId: 'r', timestamp: '2024-01-01T00:00:00.000Z', content: {} },
    });
    expect(noSource.statusCode).toBe(404);

    // Fonte duplicada:
    await app.inject({ method: 'POST', url: '/sources', payload: { kind: 'memory', id: 's1', name: 'A' } });
    const dup = await app.inject({ method: 'POST', url: '/sources', payload: { kind: 'memory', id: 's1', name: 'B' } });
    expect(dup.statusCode).toBe(409);
  });
});