/**
 * Testes do servidor HTTP (node:http puro): GET /health, POST /debug,
 * POST /ontology/check, limites e erros.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TransformationBuilder } from '../src/core/builder.js';
import { VALIDATED_MESSAGE } from '../src/core/debugger.js';
import { MAX_BODY, startServer, type StartedServer } from '../src/server/index.js';

let started: StartedServer;
let base: string;

beforeAll(async () => {
  started = await startServer(0); // porta aleatória
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => started.server.close(() => resolve()));
});

const script = new TransformationBuilder('http')
  .defineObject('Pessoa', { nome: 'string' })
  .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
  .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
  .addCondition({ id: 'c1', entity: 'Endereco', dataItemId: 'row-1' })
  .build();

const consistentOntology = {
  assignments: [
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
  ],
};

const inconsistentOntology = {
  assignments: [
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
    { kind: 'object', name: 'Endereco', properties: {} },
  ],
};

const dataSource = { type: 'csv', content: 'nome\nAda\n' };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

describe('servidor HTTP', () => {
  it('startServer(0) retorna a porta efetiva', () => {
    expect(started.port).toBeGreaterThan(0);
  });

  it('GET /health → 200 { status: "ok" }', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ status: 'ok' });
  });

  it('POST /debug com ontologia consistente → validated', async () => {
    const res = await post('/debug', { script, ontology: consistentOntology, dataSource });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.outcomes[0].kind).toBe('validated');
    expect(body.displayed).toEqual([VALIDATED_MESSAGE]);
  });

  it('POST /debug com "Endereco" atribuído como objeto → expressed invalid', async () => {
    const res = await post('/debug', { script, ontology: inconsistentOntology, dataSource });
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.outcomes[0].kind).toBe('invalid');
    expect(body.outcomes[0].expressed).toBe(true);
    expect(body.displayed[0]).toContain('invalid');
  });

  it('POST /debug com data source de texto livre (não estruturada)', async () => {
    const scriptTexto = new TransformationBuilder('t')
      .defineObject('Pessoa', { nome: 'string' })
      .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'match-1' })
      .addCondition({ id: 'c1', entity: 'Pessoa', dataItemId: 'match-1' })
      .build();
    const res = await post('/debug', {
      script: scriptTexto,
      ontology: { assignments: [{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }] },
      dataSource: {
        type: 'text',
        content: 'Ada Lovelace tem 36 anos',
        pattern: '^(?<nome>[A-Za-z ]+) tem (?<idade>\\d+) anos$',
      },
    });
    const body = await json(res);
    expect(body.success).toBe(true);
  });

  it('POST /ontology/check reporta consistência por entidade', async () => {
    const res = await post('/ontology/check', { script, ontology: inconsistentOntology });
    const body = await json(res);
    expect(body.consistent).toBe(false);
    const pessoa = body.entities.find((e: { entity: string }) => e.entity === 'Pessoa');
    const endereco = body.entities.find((e: { entity: string }) => e.entity === 'Endereco');
    expect(pessoa.consistent).toBe(true);
    expect(endereco.consistent).toBe(false);
    expect(endereco.reasons[0]).toContain('Endereco');
  });

  it('POST /ontology/check com ontologia consistente → consistent: true', async () => {
    const res = await post('/ontology/check', { script, ontology: consistentOntology });
    const body = await json(res);
    expect(body.consistent).toBe(true);
  });

  it('rota inexistente → 404', async () => {
    const res = await fetch(`${base}/nada`);
    expect(res.status).toBe(404);
  });

  it('corpo JSON malformado → 400', async () => {
    const res = await fetch(`${base}/debug`, { method: 'POST', body: '{quebrado' });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBeTruthy();
  });

  it(`corpo acima de MAX_BODY (8 MB) → 413`, async () => {
    const big = 'x'.repeat(MAX_BODY + 1);
    const res = await fetch(`${base}/debug`, { method: 'POST', body: big });
    expect(res.status).toBe(413);
  }, 20000);
});
