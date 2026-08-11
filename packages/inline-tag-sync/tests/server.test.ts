/**
 * inline-tag-sync — tests/server.test.ts
 * Testes do servidor HTTP das plataformas (rotas, validação, 413 com dreno).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_BODY, startServer } from '../src/server/index.js';
import type { StartedServer } from '../src/server/index.js';
import { DOC_NOTE, rangeOf } from './helpers.js';

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

async function seed(): Promise<void> {
  await post('/objects', {
    id: 'obj-john',
    type: 'Person',
    properties: { name: "John Doe's Profile", email: 'johndoe@email.com' },
  });
  await post('/objects', {
    id: 'obj-news',
    type: 'Article',
    properties: { title: 'Local News' },
  });
}

async function createDoc(): Promise<string> {
  const { status, json } = await post('/documents', {
    id: 'doc-1',
    title: 'Relatório semanal',
    summary: 'Cobertura pelo Local News.',
    note: DOC_NOTE,
    userId: 'ana',
  });
  expect(status).toBe(201);
  return json.document.id as string;
}

describe('servidor HTTP das plataformas', () => {
  it('GET /health responde ok', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('rota desconhecida responde 404', async () => {
    const response = await fetch(`${base}/nao-existe`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
  });

  it('POST /documents cria documento com id sequencial determinístico', async () => {
    const { status, json } = await post('/documents', { title: 'T', userId: 'ana' });
    expect(status).toBe(201);
    expect(json.document.id).toBe('doc-1');
    expect(json.document.fields.title.text).toBe('T');
  });

  it('POST /objects e /objects/search semeiam e consultam a segunda plataforma', async () => {
    await seed();
    const { status, json } = await post('/objects/search', { text: 'john doe' });
    expect(status).toBe(200);
    expect(json.results[0].objectId).toBe('obj-john');
  });

  it('POST /tags/first aplica first tag in-line', async () => {
    await seed();
    await createDoc();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    const { status, json } = await post('/tags/first', {
      documentId: 'doc-1',
      field: 'note',
      start,
      end,
      objectId: 'obj-john',
      propertyKey: 'name',
      userId: 'ana',
    });
    expect(status).toBe(201);
    expect(json.tag.origin).toBe('inline');
    expect(json.tag.label).toBe("Name: John Doe's Profile");
  });

  it('POST /tags/shortcut substitui "@texto" pela tag', async () => {
    await seed();
    const { json: created } = await post('/documents', {
      id: 'doc-1',
      note: 'Enviar para @John Doe',
      userId: 'ana',
    });
    void created;
    const { status, json } = await post('/tags/shortcut', {
      documentId: 'doc-1',
      field: 'note',
      objectId: 'obj-john',
      propertyKey: 'email',
      userId: 'ana',
    });
    expect(status).toBe(201);
    expect(json.text).toBe('Enviar para Email: johndoe@email.com');
    expect(json.tag.label).toBe('Email: johndoe@email.com');
  });

  it('POST /data-objects/generate gera data object e object view', async () => {
    await seed();
    await createDoc();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    await post('/tags/first', {
      documentId: 'doc-1',
      field: 'note',
      start,
      end,
      objectId: 'obj-john',
      propertyKey: 'name',
    });
    const { status, json } = await post('/data-objects/generate', { documentId: 'doc-1' });
    expect(status).toBe(201);
    expect(json.dataObject.type).toBe('Document');
    expect(json.dataObject.properties.documentId).toBe('doc-1');
    expect(json.view.entries).toHaveLength(1);
  });

  it('POST /tags/second atualiza documento e data object (sincronização)', async () => {
    await seed();
    await createDoc();
    await post('/data-objects/generate', { documentId: 'doc-1' });
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    const { status, json } = await post('/tags/second', {
      documentId: 'doc-1',
      field: 'note',
      start,
      end,
      objectId: 'obj-john',
      propertyKey: 'email',
      userId: 'bruno',
    });
    expect(status).toBe(201);
    expect(json.tag.origin).toBe('object-based');
    const refs = JSON.parse(json.dataObject.properties.tags) as unknown[];
    expect(refs).toHaveLength(1);
  });

  it('POST /sync/reload e /sync/finalize: re-edição sem deslocamento via HTTP', async () => {
    await seed();
    await createDoc();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    await post('/tags/first', {
      documentId: 'doc-1',
      field: 'note',
      start,
      end,
      objectId: 'obj-john',
      propertyKey: 'name',
    });
    const { json: generated } = await post('/data-objects/generate', { documentId: 'doc-1' });
    const dataObjectId = generated.dataObject.id as string;

    const reload = await post('/sync/reload', { dataObjectId });
    expect(reload.status).toBe(200);
    expect(reload.json.session.document.tags).toEqual([]);
    expect(reload.json.session.absoluteLocations).toHaveLength(1);

    const finalize = await post('/sync/finalize', {
      dataObjectId,
      fields: { note: 'Contato: John Doe esteve no evento. Atualizado.' },
      userId: 'ana',
    });
    expect(finalize.status).toBe(200);
    expect(finalize.json.document.tags).toHaveLength(1);
    expect(finalize.json.document.tags[0].start).toBe(start);
    expect(finalize.json.document.tags[0].end).toBe(end);
    expect(finalize.json.dataObject.properties.note).toContain('Atualizado.');
  });

  it('valida corpo: JSON inválido → 400; campo inválido → 400', async () => {
    const bad = await fetch(`${base}/documents`, { method: 'POST', body: 'não-json' });
    expect(bad.status).toBe(400);
    await createDoc();
    const { status, json } = await post('/tags/first', {
      documentId: 'doc-1',
      field: 'body',
      start: 0,
      end: 1,
      objectId: 'obj-john',
      propertyKey: 'name',
    });
    expect(status).toBe(400);
    expect(json.error).toContain('"field"');
  });

  it('documento desconhecido → 404', async () => {
    const { status, json } = await post('/tags/first', {
      documentId: 'doc-zzz',
      field: 'note',
      start: 0,
      end: 1,
      objectId: 'obj-john',
      propertyKey: 'name',
    });
    expect(status).toBe(404);
    expect(json.error).toContain('doc-zzz');
  });

  it('corpo acima de 8 MB → 413 (com dreno do corpo)', async () => {
    const response = await fetch(`${base}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"title":"${'x'.repeat(MAX_BODY)}"}`,
    });
    expect(response.status).toBe(413);
    const json = (await response.json()) as { error?: string };
    expect(json.error).toContain('limite');
  });
});
