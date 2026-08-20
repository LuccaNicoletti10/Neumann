// bounded-fair-scheduler — testes do servidor HTTP (mecanismos 3-9 via API REST).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseManagementSystem } from '../src/core/dbms.js';
import { BoundedFairScheduler } from '../src/core/scheduler.js';
import { generateRows, ManualClock } from '../src/core/types.js';
import { startServer } from '../src/server/index.js';
import type { StartedServer } from '../src/server/index.js';

let started: StartedServer;

async function startTestServer(maxQueueSize: number): Promise<StartedServer> {
  const dbms = DatabaseManagementSystem.uniform(['node-A', 'node-B'], generateRows(1000));
  const sched = new BoundedFairScheduler({
    maxQueueSize,
    maxTaskSize: 50,
    clock: new ManualClock(0),
    dbms,
    defaultNode: 'node-A',
  });
  return startServer(0, '127.0.0.1', {
    scheduler: sched,
    dbms,
    maxTaskSize: 50,
    maxQueueSize,
  });
}

function closeServer(s: StartedServer): Promise<void> {
  return new Promise<void>((resolve) => {
    s.server.close(() => resolve());
  });
}

beforeEach(async () => {
  started = await startTestServer(1);
});

afterEach(async () => {
  await closeServer(started);
});

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${started.url}${path}`, init);
  const body = (await res.json()) as unknown;
  return { status: res.status, body };
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('HTTP — endpoints básicos', () => {
  it('GET /health → 200 ok', async () => {
    const { status, body } = await api('/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('rota desconhecida → 404', async () => {
    const { status } = await api('/nope');
    expect(status).toBe(404);
  });

  it('POST /jobs com corpo inválido → 400', async () => {
    const r1 = await api('/jobs', postJson({ query: 'sem cost' }));
    expect(r1.status).toBe(400);
    const r2 = await api('/jobs', postJson({ costEstimate: 10 }));
    expect(r2.status).toBe(400);
    const r3 = await api('/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{json quebrado',
    });
    expect(r3.status).toBe(400);
  });
});

describe('HTTP — admissão bounded e snapshot da fila', () => {
  it('1º submit → execution; 2º (fila cheia) → waiting; GET /queue reflete posições', async () => {
    const r1 = await api('/jobs', postJson({ query: 'q1', costEstimate: 100 }));
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ jobId: 'job-1', admitted: 'execution' });

    const r2 = await api('/jobs', postJson({ query: 'q2', costEstimate: 100 }));
    expect(r2.body).toMatchObject({ jobId: 'job-2', admitted: 'waiting' });

    const q = await api('/queue');
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({
      maxQueueSize: 1,
      occupancy: 1,
      isFull: true,
      execution: [{ jobId: 'job-1', position: 1 }],
      waiting: [{ jobId: 'job-2', position: 1 }],
    });

    const j2 = await api('/jobs/job-2');
    expect(j2.status).toBe(200);
    expect(j2.body).toMatchObject({ status: 'queued-waiting', admittedTo: 'waiting' });

    const j404 = await api('/jobs/desconhecido');
    expect(j404.status).toBe(404);
  });
});

describe('HTTP — run, cancel e migração', () => {
  it('POST /run executa até esvaziar; job completo reporta métricas', async () => {
    await api('/jobs', postJson({ query: 'q1', costEstimate: 100 }));
    await api('/jobs', postJson({ query: 'q2', costEstimate: 10 }));
    const run = await api('/run', postJson({}));
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ queue: { occupancy: 0, waiting: [] } });
    const m = await api('/jobs/job-2');
    expect(m.body).toMatchObject({ status: 'completed', rowsReturned: 10 });
    const metrics = m.body as { completionLatencyMs: number | null };
    expect(metrics.completionLatencyMs).not.toBeNull();
  });

  it('POST /jobs/:id/cancel na execution libera slot e promove waiting; 404 se inexistente', async () => {
    await api('/jobs', postJson({ query: 'q1', costEstimate: 1000 }));
    await api('/jobs', postJson({ query: 'q2', costEstimate: 100 }));
    const cancel = await api('/jobs/job-1/cancel', postJson({}));
    expect(cancel.status).toBe(200);
    expect(cancel.body).toMatchObject({ jobId: 'job-1', cancelled: true });
    expect(cancel.body).toMatchObject({
      queue: { execution: [{ jobId: 'job-2', position: 1 }], waiting: [] },
    });
    const again = await api('/jobs/job-1/cancel', postJson({}));
    expect(again.status).toBe(404); // já cancelado, não está mais enfileirado
    const nope = await api('/jobs/nope/cancel', postJson({}));
    expect(nope.status).toBe(404);
  });

  it('cancel na waiting remove da waiting', async () => {
    await api('/jobs', postJson({ query: 'q1', costEstimate: 1000 }));
    await api('/jobs', postJson({ query: 'q2', costEstimate: 100 }));
    const cancel = await api('/jobs/job-2/cancel', postJson({}));
    expect(cancel.status).toBe(200);
    expect(cancel.body).toMatchObject({ queue: { waiting: [] } });
  });

  it('POST /jobs/:id/migrate {toNode} gera 2º job no nó B; 400/404 nos casos ruins', async () => {
    await api('/jobs', postJson({ query: 'q1', costEstimate: 100 }));
    await api('/run', postJson({ steps: 1 })); // executa 1 sub-task no node-A
    const mig = await api('/jobs/job-1/migrate', postJson({ toNode: 'node-B' }));
    expect(mig.status).toBe(200);
    expect(mig.body).toMatchObject({ fromNode: 'node-A', toNode: 'node-B' });
    const newJobId = (mig.body as { newJobId: string }).newJobId;
    expect(newJobId).not.toBe('job-1');
    await api('/run', postJson({}));
    const m = await api(`/jobs/${newJobId}`);
    expect(m.body).toMatchObject({ status: 'completed', node: 'node-B', rowsReturned: 100 });

    const bad = await api('/jobs/job-2/migrate', postJson({}));
    expect(bad.status).toBe(400);
    const notFound = await api('/jobs/job-1/migrate', postJson({ toNode: 'node-B' }));
    expect(notFound.status).toBe(404); // job-1 já migrado, fora da fila
    const sameNode = await api(`/jobs/${newJobId}/migrate`, postJson({ toNode: 'node-B' }));
    expect(sameNode.status).toBe(404); // newJobId já completou
  });
});

describe('HTTP — comparador', () => {
  it('POST /compare retorna relatório com redução de latência low-cost', async () => {
    // Servidor com fila folgada: fair-bounded intercala o job pequeno (diferente de FCFS).
    const roomy = await startTestServer(8);
    try {
      const res = await fetch(`${roomy.url}/compare`, postJson({
        jobs: [
          { query: 'pesada', costEstimate: 1000 },
          { query: 'leve', costEstimate: 10 },
        ],
      }));
      expect(res.status).toBe(200);
      const report = (await res.json()) as {
        lowCost: { count: number; completionLatencyReductionPct: number | null };
      };
      expect(report.lowCost.count).toBe(1);
      expect(report.lowCost.completionLatencyReductionPct ?? 0).toBeGreaterThan(0);
    } finally {
      await closeServer(roomy);
    }
  });

  it('POST /compare sem jobs → 400', async () => {
    const res = await api('/compare', postJson({}));
    expect(res.status).toBe(400);
  });
});