/**
 * schema-registry — tests/server.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_BODY, startServer } from '../src/server/index.js';
import type { StartedServer } from '../src/server/index.js';
import { peopleSchema } from './helpers.js';

let started: StartedServer;
let base: string;

beforeEach(async () => {
  started = await startServer(0);
  base = `http://127.0.0.1:${started.port}`;
});

afterEach(async () => {
  await started.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('HTTP schema-registry', () => {
  it('GET /health', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('register → observe compatible → list', async () => {
    const reg = await post('/schemas/register', peopleSchema());
    expect(reg.status).toBe(201);
    expect(reg.json.schema.schemaVersion).toBe(1);

    const obs = await post('/schemas/observe', {
      ...peopleSchema(),
      columns: [
        ...peopleSchema().columns,
        { column: 'city', physicalType: 'string', nullable: true },
      ],
    });
    expect(obs.status).toBe(200);
    expect(obs.json.report.kind).toBe('compatible');
    expect(obs.json.schema.schemaVersion).toBe(2);

    const list = await fetch(`${base}/schemas?source=crm`);
    const listed = (await list.json()) as { schemas: unknown[] };
    expect(listed.schemas).toHaveLength(1);
  });

  it('observe breaking → 200 com paused + alert; próximo observe → 409', async () => {
    await post('/schemas/register', peopleSchema());
    const breaking = await post('/schemas/observe', {
      ...peopleSchema(),
      columns: peopleSchema().columns.filter((c) => c.column !== 'name'),
    });
    expect(breaking.json.report.kind).toBe('breaking');
    expect(breaking.json.schema.paused).toBe(true);

    const paused = await post('/schemas/observe', peopleSchema());
    expect(paused.status).toBe(409);
    expect(paused.json.code).toBe('SOURCE_PAUSED');
  });

  it('POST /discover a partir de csv', async () => {
    const response = await post('/discover', {
      source: 'crm',
      object: 'people',
      csv: 'id,email\n1,a@b.c\n2,d@e.f\n',
    });
    expect(response.status).toBe(200);
    expect(response.json.observed.columns.find((c: any) => c.column === 'email').semanticHint).toBe(
      'email',
    );
  });

  it('POST /mappings/suggest', async () => {
    const response = await post('/mappings/suggest', {
      source: 'crm',
      object: 'people',
      columns: [
        { column: 'first_name', physicalType: 'string', nullable: false },
        { column: 'email', physicalType: 'string', nullable: true, semanticHint: 'email' },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.json.suggestions.length).toBeGreaterThan(0);
  });

  it('corpo > 8MB → 413', async () => {
    const response = await fetch(`${base}/schemas/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 's', object: 'o', columns: [], pad: 'x'.repeat(MAX_BODY) }),
    });
    expect(response.status).toBe(413);
  });

  it('rota desconhecida → 404', async () => {
    const response = await fetch(`${base}/nope`);
    expect(response.status).toBe(404);
  });
});
