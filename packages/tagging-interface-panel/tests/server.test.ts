/**
 * tagging-interface-panel — tests/server.test.ts
 * Testes da API HTTP do painel (node:http puro, MAX_BODY 8 MB, 413).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_BODY, startServer } from '../src/server/index.js';
import type { StartedServer } from '../src/server/index.js';

let started: StartedServer;
let base: string;

beforeEach(async () => {
  started = await startServer(0);
  base = `http://localhost:${started.port}`;
});

afterEach(async () => {
  await started.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('API HTTP do painel', () => {
  it('GET /health responde ok', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('rota desconhecida responde 404', async () => {
    const response = await fetch(`${base}/nada`);
    expect(response.status).toBe(404);
  });

  it('POST /panel/select auto-preenche TITLE/TYPE e devolve o label do conteúdo', async () => {
    const { status, json } = await post('/panel/select', {
      content: 'O rover Curiosity segue viagem.',
      portion: 'Curiosity',
    });
    expect(status).toBe(200);
    const body = json as { fields: { id: string; value?: string }[]; contentLabel: string };
    expect(body.fields.find((f) => f.id === 'TITLE')?.value).toBe('Curiosity');
    expect(body.fields.find((f) => f.id === 'TYPE')?.value).toBe('Ground Travel');
    expect(body.contentLabel).toBe('content-1');
  });

  it('POST /panel/select valida entrada', async () => {
    expect((await post('/panel/select', { content: 'c' })).status).toBe(400);
    expect(
      (await post('/panel/select', { content: 'c', portion: 'p', contentKind: 'holograma' }))
        .status,
    ).toBe(400);
  });

  it('POST /panel/options devolve os campos dinâmicos da opção', async () => {
    const { status, json } = await post('/panel/options', { option: 'link' });
    expect(status).toBe(200);
    const fields = (json as { fields: { id: string }[] }).fields.map((f) => f.id);
    expect(fields).toEqual(['TITLE', 'TYPE', 'LINK_TARGET_1', 'LINK_TARGET_2']);
    expect((await post('/panel/options', { option: 'warp' })).status).toBe(400);
  });

  it('fluxo: select → options → tags → tagged-objects', async () => {
    await post('/panel/select', { content: 'página', portion: 'Curiosity' });
    await post('/panel/options', { option: 'object' });
    const created = await post('/panel/tags', {});
    expect(created.status).toBe(201);
    const tag = (created.json as { tag: { id: string; title: string; type: string } }).tag;
    expect(tag.title).toBe('Curiosity');
    expect(tag.type).toBe('Ground Travel');

    const response = await fetch(`${base}/panel/tagged-objects`);
    const listed = (await response.json()) as {
      objects: { tagId: string; title: string }[];
      properties: unknown[];
    };
    expect(listed.objects.map((o) => o.tagId)).toEqual([tag.id]);
    expect(listed.properties).toEqual([]);
  });

  it('POST /panel/tags cria link tag com 2+ alvos', async () => {
    await post('/panel/select', { content: 'p', portion: 'Curiosity' });
    await post('/panel/options', { option: 'object' });
    const a = ((await post('/panel/tags', {})).json as { tag: { id: string } }).tag;
    await post('/panel/select', { content: 'p2', portion: 'Odyssey flight' });
    await post('/panel/options', { option: 'object' });
    const b = ((await post('/panel/tags', {})).json as { tag: { id: string } }).tag;
    await post('/panel/options', { option: 'link' });
    const linked = await post('/panel/tags', {
      title: 'L',
      type: 'Vehicle',
      targetObjectIds: [a.id, b.id],
    });
    expect(linked.status).toBe(201);
    const semAlvos = await post('/panel/tags', { title: 'L2', type: 'Vehicle' });
    expect(semAlvos.status).toBe(400);
  });

  it('POST /panel/search + POST /panel/sync', async () => {
    await post('/panel/select', { content: 'p', portion: 'Curiosity' });
    await post('/panel/options', { option: 'object' });
    const tag = ((await post('/panel/tags', {})).json as { tag: { id: string } }).tag;
    const searched = await post('/panel/search', { query: 'Curiosity' });
    const results = (searched.json as { results: { objectId: string }[] }).results;
    expect(results[0]?.objectId).toBe('obj-curiosity');
    const synced = await post('/panel/sync', { tagId: tag.id, objectId: 'obj-curiosity' });
    expect(synced.status).toBe(200);
    expect(
      (synced.json as { taggedObject: { syncedObjectId?: string } }).taggedObject.syncedObjectId,
    ).toBe('obj-curiosity');
  });

  it('POST /panel/export devolve pares parâmetro-valor das tags', async () => {
    await post('/panel/select', { content: 'página', portion: 'Curiosity' });
    await post('/panel/options', { option: 'object' });
    await post('/panel/tags', {});
    const exported = await post('/panel/export', { destination: 'both' });
    expect(exported.status).toBe(200);
    const result = (
      exported.json as {
        result: { pairsPerTag: { pairs: { parameter: string; value: string }[] }[] };
      }
    ).result;
    const pairs = result.pairsPerTag[0]?.pairs ?? [];
    expect(pairs.map((p) => p.parameter)).toEqual([
      'TagOption',
      'Title',
      'Type',
      'Content',
      'DateAdded',
      'User',
    ]);
    expect((await post('/panel/export', { destination: 'lua' })).status).toBe(400);
  });

  it('corpo inválido responde 400', async () => {
    const response = await fetch(`${base}/panel/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{não é json',
    });
    expect(response.status).toBe(400);
  });

  it('corpo acima de 8 MB responde 413 (com dreno do corpo)', async () => {
    const grande = JSON.stringify({ content: 'x'.repeat(MAX_BODY), portion: 'p' });
    const response = await fetch(`${base}/panel/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: grande,
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('corpo excede');
  });
});

describe('servidor sem login', () => {
  it('sync e export respondem 401 sem login', async () => {
    const semLogin = await startServer(0, { loggedIn: false });
    try {
      const baseUrl = `http://localhost:${semLogin.port}`;
      const response = await fetch(`${baseUrl}/panel/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('LOGIN_REQUIRED');
    } finally {
      await semLogin.close();
    }
  });
});
