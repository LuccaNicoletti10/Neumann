/**
 * Mecanismos 1, 5, 6 e 7 via HTTP: /health; submit → run → GET job;
 * cancel via HTTP; migração via HTTP; /compare retorna ambos os modos;
 * erros 400/404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseManagementSystem, DatabaseNode } from '../src/core/dbms.js';
import { FairScheduler } from '../src/core/scheduler.js';
import { FakeClock } from '../src/core/types.js';
import { startServer, type ServerDeps, type StartedServer } from '../src/server/index.js';
import { genRows } from './helpers.js';

let server: StartedServer;
let base: string;

beforeAll(async () => {
  const dbms = new DatabaseManagementSystem([
    new DatabaseNode('node-a', { t: genRows(1000), small: genRows(10, 's'), medium: genRows(250, 'm') }),
    new DatabaseNode('node-b', { t: genRows(1000), small: genRows(10, 's'), medium: genRows(250, 'm') }),
  ]);
  const deps: ServerDeps = {
    dbms,
    scheduler: new FairScheduler({ dbms, clock: new FakeClock(0), thresholdCost: 100 }),
    thresholdCost: 100,
  };
  server = await startServer(0, '127.0.0.1', deps);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

async function post(path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('servidor HTTP', () => {
  it('GET /health → ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('submit → run → GET job retorna estado done + resultados + métricas', async () => {
    const { status, json } = await post('/jobs', { query: 'small', costEstimate: 10 });
    expect(status).toBe(201);
    const jobId = json['jobId'] as string;
    expect(jobId).toMatch(/^job-\d+$/);

    const res = await fetch(`${base}/jobs/${jobId}`);
    expect(res.status).toBe(200);
    const job = (await res.json()) as Record<string, unknown>;
    expect(job['state']).toBe('done');
    expect(job['rowCount']).toBe(10);
    expect((job['rows'] as unknown[]).length).toBe(10);
    const metrics = job['metrics'] as Record<string, unknown>;
    expect(metrics['firstResultLatencyMs']).toBe(15); // 5 + 1×10
    expect(metrics['completionTimeMs']).toBe(15);
  });

  it('cancel via HTTP: job grande é removido da fila antes de executar', async () => {
    const { json } = await post('/jobs', { query: 't', costEstimate: 1000 });
    const jobId = json['jobId'] as string;

    const cancel = await post(`/jobs/${jobId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.json['ok']).toBe(true);
    expect(cancel.json['state']).toBe('cancelled');

    const res = await fetch(`${base}/jobs/${jobId}`);
    const job = (await res.json()) as Record<string, unknown>;
    expect(job['state']).toBe('cancelled');
    expect(job['rowCount']).toBe(0);
  });

  it('migrate via HTTP: próxima sub-task executa no nó destino', async () => {
    const { json } = await post('/jobs', { query: 'medium', costEstimate: 250 });
    const jobId = json['jobId'] as string;

    const mig = await post(`/jobs/${jobId}/migrate`, { toNode: 'node-b' });
    expect(mig.status).toBe(200);
    expect(mig.json['ok']).toBe(true);
    expect(mig.json['node']).toBe('node-b');

    const res = await fetch(`${base}/jobs/${jobId}`);
    const job = (await res.json()) as Record<string, unknown>;
    expect(job['state']).toBe('done');
    expect(job['rowCount']).toBe(250);
    const log = job['taskLog'] as Array<Record<string, unknown>>;
    for (const t of log) expect(t['node']).toBe('node-b');
  });

  it('POST /compare retorna métricas dos dois modos', async () => {
    const { status, json } = await post('/compare', {
      jobs: [
        { query: 't', costEstimate: 1000 },
        { query: 'small', costEstimate: 10 },
      ],
    });
    expect(status).toBe(200);
    const fcfs = json['fcfs'] as Record<string, unknown>;
    const fair = json['fair'] as Record<string, unknown>;
    expect(fcfs['mode']).toBe('fcfs');
    expect(fair['mode']).toBe('fair');
    const fcfsJobs = fcfs['jobs'] as Array<Record<string, unknown>>;
    const fairJobs = fair['jobs'] as Array<Record<string, unknown>>;
    expect(fcfsJobs).toHaveLength(2);
    expect(fairJobs).toHaveLength(2);
    // Job pequeno: conclusão mais cedo no modo fair.
    expect(fairJobs[1]!['completionTimeMs'] as number).toBeLessThan(fcfsJobs[1]!['completionTimeMs'] as number);
  });

  it('400: JSON inválido e job inválido; 404: rota e job desconhecidos', async () => {
    const badJson = await fetch(`${base}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalido',
    });
    expect(badJson.status).toBe(400);

    expect((await post('/jobs', { costEstimate: 10 })).status).toBe(400); // sem query
    expect((await post('/jobs', { query: 't' })).status).toBe(400); // sem costEstimate
    expect((await post('/compare', { jobs: [] })).status).toBe(400);
    expect((await post('/jobs/job-999/migrate', { toNode: 'node-b' })).status).toBe(404);

    const notFoundJob = await fetch(`${base}/jobs/job-999`);
    expect(notFoundJob.status).toBe(404);
    const notFoundRoute = await fetch(`${base}/rota-inexistente`);
    expect(notFoundRoute.status).toBe(404);
  });
});
