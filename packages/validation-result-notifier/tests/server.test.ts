import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY, startServer, type RunningServer, type ValidateResponseBody } from '../src/server/index.js';

let running: RunningServer;
let base: string;

beforeAll(async () => {
  running = await startServer(0); // porta efêmera → efetiva resolvida
  base = `http://127.0.0.1:${running.port}`;
});

afterAll(async () => {
  await running.close();
});

const scriptValido = {
  name: 's1',
  entities: [
    { entity: 'Cliente', kind: 'object' },
    { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
  ],
  ontologyParameters: [
    { name: 'p-nome', defines: { entity: 'nome', kind: 'property', parentObject: 'Cliente' }, acceptedTypes: ['record'] },
  ],
  conditions: [
    {
      id: 'c1',
      description: 'válida intermediária',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'a1', parameterName: 'p-nome' }],
    },
    {
      id: 'c2',
      description: 'inválida',
      assignment: { entity: 'nome', kind: 'object' },
      mappings: [],
    },
    {
      id: 'c3',
      description: 'válida final',
      assignment: { entity: 'Cliente', kind: 'object' },
      mappings: [],
    },
  ],
};

async function postValidate(body: unknown): Promise<Response> {
  return fetch(`${base}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('servidor HTTP (node:http puro)', () => {
  it('startServer(0) resolve a porta efetiva', () => {
    expect(running.port).toBeGreaterThan(0);
  });

  it('GET /health → 200 ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'validation-result-notifier' });
  });

  it('GET /channels → canais, formas e limite de corpo', async () => {
    const res = await fetch(`${base}/channels`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['channels']).toEqual(['debugger', 'email', 'popup']);
    expect(body['forms']).toEqual(['message', 'acronym', 'number', 'graphic']);
    expect(body['maxBody']).toBe(MAX_BODY);
  });

  it('POST /validate (fonte estruturada CSV): implicit não entregue, expressed entregue', async () => {
    const res = await postValidate({
      script: scriptValido,
      dataSource: { format: 'csv', content: 'id,nome\na1,Ada' },
      notify: { channel: 'debugger', form: 'message' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ValidateResponseBody;
    expect(body.results.map((r) => r.kind)).toEqual(['implicit', 'expressed', 'expressed']);
    expect(body.delivered.map((d) => d.conditionId)).toEqual(['c2', 'c3']);
    expect(body.delivered[1]?.content).toBe("OK — script validated (condição 'c3')");
    expect(body.captured).toEqual({ debugger: 2, email: 0, popup: 0 });
  });

  it('POST /validate (fonte NÃO estruturada texto) com mapping incompatível via email+graphic', async () => {
    const res = await postValidate({
      script: {
        name: 's2',
        entities: [{ entity: 'Doc', kind: 'object' }],
        ontologyParameters: [
          { name: 'p-doc', defines: { entity: 'Doc', kind: 'object' }, acceptedTypes: ['record'] },
        ],
        conditions: [
          {
            id: 'cx',
            description: 'mapping de texto em parâmetro que só aceita record',
            assignment: { entity: 'Doc', kind: 'object' },
            mappings: [{ dataItemId: 'line-0', parameterName: 'p-doc' }],
          },
        ],
      },
      dataSource: { format: 'text', content: 'documento livre sem estrutura' },
      notify: { channel: 'email', form: 'graphic' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ValidateResponseBody;
    expect(body.results[0]?.verdict.valid).toBe(false);
    expect(body.delivered[0]?.form).toBe('graphic');
    expect(body.delivered[0]?.content).toContain('| Codigo  : EINV-MAP-002');
    expect(body.captured).toEqual({ debugger: 0, email: 1, popup: 0 });
  });

  it('POST /validate sem notify: roteamento padrão (fallback debugger)', async () => {
    const res = await postValidate({
      script: scriptValido,
      dataSource: { format: 'csv', content: 'id,nome\na1,Ada' },
    });
    const body = (await res.json()) as ValidateResponseBody;
    expect(body.captured).toEqual({ debugger: 2, email: 0, popup: 0 });
  });

  it('POST /validate com JSON inválido → 400', async () => {
    const res = await fetch(`${base}/validate`, { method: 'POST', body: '{nao-e-json' });
    expect(res.status).toBe(400);
  });

  it('POST /validate com spec inválido → 400', async () => {
    const res = await postValidate({ script: { name: 'x' }, dataSource: { format: 'csv', content: '' } });
    expect(res.status).toBe(400);
  });

  it('POST /validate com canal desconhecido → 400', async () => {
    const res = await postValidate({
      script: scriptValido,
      dataSource: { format: 'csv', content: 'id,nome\na1,Ada' },
      notify: { channel: 'fax' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /validate com corpo acima de 8 MB → 413', async () => {
    const res = await fetch(`${base}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"pad":"${'x'.repeat(MAX_BODY + 1)}"}`,
    });
    expect(res.status).toBe(413);
  });

  it('rota inexistente → 404; método errado → 405', async () => {
    expect((await fetch(`${base}/nada`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/validate`)).status).toBe(405);
  });
});
