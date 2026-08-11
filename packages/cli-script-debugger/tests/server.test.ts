/**
 * cli-script-debugger — tests/server.test.ts
 * Testa a debugger application HTTP: GET /health, POST /debug com config
 * inline (embutido ou por referência), limite de corpo e erros.
 */
import { describe, expect, it } from 'vitest';

import { MAX_BODY, startServer } from '../src/server/index.js';
import type { StartedServer } from '../src/server/index.js';
import { makeTempDir, sampleCsv, sampleOntology, sampleScript, writeFile } from './helpers.js';
import { serializeScript } from '../src/core/builder.js';

interface DebugResponse {
  verdict?: { valid: boolean };
  indication?: { kind: string; form: string; content: string };
  error?: string;
}

async function postDebug(port: number, body: string): Promise<{ status: number; json: DebugResponse }> {
  const res = await fetch(`http://127.0.0.1:${port}/debug`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { status: res.status, json: (await res.json()) as DebugResponse };
}

describe('servidor HTTP', () => {
  let started: StartedServer;

  it('sobe com porta efetiva e responde GET /health', async () => {
    started = await startServer(0);
    expect(started.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${started.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /debug com config inline embutida (script/ontologia/dados)', async () => {
    const { status, json } = await postDebug(
      started.port,
      JSON.stringify({
        script: sampleScript(),
        ontology: sampleOntology(),
        data: sampleCsv(),
        dataFormat: 'csv',
      }),
    );
    expect(status).toBe(200);
    expect(json.verdict?.valid).toBe(true);
    expect(json.indication?.kind).toBe('implicit');
  });

  it('POST /debug com referências a arquivos', async () => {
    const dir = makeTempDir();
    const scriptPath = writeFile(dir, 'script.json', serializeScript(sampleScript()));
    const ontologyPath = writeFile(dir, 'ontologia.json', JSON.stringify(sampleOntology()));
    const dataPath = writeFile(dir, 'dados.csv', sampleCsv());
    const { status, json } = await postDebug(
      started.port,
      JSON.stringify({ scriptFile: scriptPath, ontologyFile: ontologyPath, dataFile: dataPath }),
    );
    expect(status).toBe(200);
    expect(json.verdict?.valid).toBe(true);
  });

  it('POST /debug detecta atribuição inconsistente e expressa a indicação', async () => {
    const ontology = sampleOntology();
    ontology.parameters[0] = {
      name: 'personId',
      entity: 'pessoa',
      assignment: { kind: 'property', objectType: 'Person', property: 'id' },
    };
    const { status, json } = await postDebug(
      started.port,
      JSON.stringify({
        script: sampleScript(),
        ontology,
        data: sampleCsv(),
        form: 'acronym',
      }),
    );
    expect(status).toBe(200);
    expect(json.verdict?.valid).toBe(false);
    expect(json.indication?.kind).toBe('expressed');
    expect(json.indication?.content).toContain('ERR:');
  });

  it('POST /debug em modo lazy (associação durante o debug)', async () => {
    const { status, json } = await postDebug(
      started.port,
      JSON.stringify({
        script: sampleScript(),
        ontology: sampleOntology(),
        data: sampleCsv(),
        mode: 'lazy',
      }),
    );
    expect(status).toBe(200);
    expect(json.verdict?.valid).toBe(true);
  });

  it('POST /debug com JSON inválido → 400', async () => {
    const { status } = await postDebug(started.port, 'isso não é json');
    expect(status).toBe(400);
  });

  it('POST /debug sem script → 400', async () => {
    const { status, json } = await postDebug(
      started.port,
      JSON.stringify({ ontology: sampleOntology(), data: sampleCsv() }),
    );
    expect(status).toBe(400);
    expect(json.error).toContain('script');
  });

  it('POST /debug com corpo acima de 8 MB → 413', async () => {
    const big = ' '.repeat(MAX_BODY + 16);
    const res = await fetch(`http://127.0.0.1:${started.port}/debug`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it('rota desconhecida → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${started.port}/nada`);
    expect(res.status).toBe(404);
  });

  it('encerra limpo', async () => {
    await started.close();
  });
});
