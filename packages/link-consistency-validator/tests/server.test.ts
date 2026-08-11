/**
 * link-consistency-validator — testes do servidor HTTP (node:http) que expõe a
 * operação de depuração da patente US 8,930,897 B2.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY, startServer, type RunningServer } from '../src/server/index.js';

let server: RunningServer;
let base: string;

beforeAll(async () => {
  server = await startServer(0);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

const SCRIPT = [
  'object Pessoa',
  'object Empresa',
  'link Pessoa --trabalha_em--> Empresa',
  'condition c1 Pessoa --trabalha_em--> Empresa uses csv-1',
].join('\n');

const VALID_BODY = {
  script: SCRIPT,
  ontology: { links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }] },
  dataSource: { type: 'csv', content: 'nome\nAna' },
};

describe('servidor HTTP', () => {
  it('GET /health responde status ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /validate retorna a sequência de resultados e as mensagens exibidas', async () => {
    const res = await fetch(`${base}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ kind: string; valid: boolean; message: string }>;
      displayed: string[];
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      kind: 'expressed',
      valid: true,
      message: 'transformation script has been validated',
    });
    expect(body.displayed).toEqual(['transformation script has been validated']);
  });

  it('POST /validate com link inconsistente retorna resultado expressed inválido', async () => {
    const res = await fetch(`${base}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...VALID_BODY,
        ontology: { links: [{ from: 'Empresa', predicate: 'trabalha_em', to: 'Pessoa' }] },
      }),
    });
    const body = (await res.json()) as { results: Array<{ kind: string; valid: boolean }> };
    expect(body.results[0]).toMatchObject({ kind: 'expressed', valid: false });
  });

  it('POST /validate com campos ausentes → 400', async () => {
    const res = await fetch(`${base}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: SCRIPT }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /validate com DSL inválida → 422', async () => {
    const res = await fetch(`${base}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, script: 'instrução inválida' }),
    });
    expect(res.status).toBe(422);
  });

  it('POST /parse-dsl retorna o script parseado', async () => {
    const res = await fetch(`${base}/parse-dsl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: SCRIPT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: unknown[]; links: unknown[]; conditions: unknown[] };
    expect(body.entities).toHaveLength(2);
    expect(body.links).toHaveLength(1);
    expect(body.conditions).toHaveLength(1);
  });

  it('POST /parse-dsl com erro de sintaxe → 422 com a linha', async () => {
    const res = await fetch(`${base}/parse-dsl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'object Pessoa\n@@@' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { line: number };
    expect(body.line).toBe(2);
  });

  it('corpo não-JSON → 400', async () => {
    const res = await fetch(`${base}/validate`, { method: 'POST', body: 'não é json' });
    expect(res.status).toBe(400);
  });

  it('corpo acima de MAX_BODY (8 MB) → 413', async () => {
    const res = await fetch(`${base}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"script":"${'x'.repeat(MAX_BODY)}"}`,
    });
    expect(res.status).toBe(413);
  });

  it('rota desconhecida → 404', async () => {
    const res = await fetch(`${base}/inexistente`);
    expect(res.status).toBe(404);
  });
});
