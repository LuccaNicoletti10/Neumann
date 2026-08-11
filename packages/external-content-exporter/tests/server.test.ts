/**
 * external-content-exporter — tests/server.test.ts
 * Testes do servidor HTTP (fluxo completo + 401 + 413 com dreno).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_BODY, startServer } from '../src/server/index.js';
import type { StartedServer } from '../src/server/index.js';
import { postJson } from './helpers.js';

let started: StartedServer;

beforeEach(async () => {
  started = await startServer(0);
});

afterEach(async () => {
  await started.close();
});

/** Fluxo auxiliar: cria bookmarklet, ativa sessão e cria uma tag pendente. */
async function criarTagPendente(): Promise<{ sessionId: string; tagId: string }> {
  const bookmarklet = await postJson(started.port, '/bookmarklets', {
    name: 'Taguear',
    commands: ['exibirTaggingInterface()'],
  });
  const bookmarkletId = bookmarklet.json['id'] as string;
  const session = await postJson(started.port, '/sessions', {
    bookmarkletId,
    url: 'https://externo.example.com/relatorio.pdf',
  });
  const sessionId = session.json['sessionId'] as string;
  const tag = await postJson(started.port, `/sessions/${sessionId}/tags`, {
    tagOption: 'object',
    title: 'Suspeito',
    type: 'Person',
    selection: { kind: 'text', startOffset: 0, endOffset: 10 },
  });
  const tagId = (tag.json['tag'] as Record<string, unknown>)['id'] as string;
  return { sessionId, tagId };
}

describe('servidor HTTP', () => {
  it('GET /health responde ok', async () => {
    const response = await fetch(`http://localhost:${started.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('POST /login com credenciais válidas devolve sessão; inválidas dão 401', async () => {
    const ok = await postJson(started.port, '/login', { user: 'analyst', password: 'senha-demo' });
    expect(ok.status).toBe(200);
    expect(ok.json['token']).toBe('session-1');
    expect(ok.json['createdAt']).toBe('2024-01-01T00:00:00.000Z');
    const ruim = await postJson(started.port, '/login', { user: 'analyst', password: 'errada' });
    expect(ruim.status).toBe(401);
    expect(ruim.json['code']).toBe('INVALID_CREDENTIALS');
  });

  it('POST /logout encerra a sessão', async () => {
    const login = await postJson(started.port, '/login', { user: 'analyst', password: 'senha-demo' });
    const token = login.json['token'] as string;
    const logout = await postJson(started.port, '/logout', {}, { 'x-session-token': token });
    expect(logout.json['loggedOut']).toBe(true);
  });

  it('POST /bookmarklets cria o bookmark com URL javascript:', async () => {
    const response = await postJson(started.port, '/bookmarklets', {
      name: 'Taguear',
      commands: ['a()', 'b()'],
    });
    expect(response.status).toBe(201);
    expect(response.json['id']).toBe('bookmarklet-1');
    expect(String(response.json['url'])).toMatch(/^javascript:/);
  });

  it('POST /sessions ativa o bookmarklet: enhance + tagging interface', async () => {
    const bookmarklet = await postJson(started.port, '/bookmarklets', {
      name: 'Taguear',
      commands: ['exibirTaggingInterface()'],
    });
    const response = await postJson(started.port, '/sessions', {
      bookmarkletId: bookmarklet.json['id'],
      url: 'https://externo.example.com/doc.pdf',
    });
    expect(response.status).toBe(201);
    expect(response.json['sessionId']).toBe('tagging-1');
    expect(response.json['contentLabel']).toBe('content-1');
    expect(response.json['enhanced']).toBe(true);
    expect(response.json['taggingInterfaceVisible']).toBe(true);
  });

  it('POST /sessions/:id/tags recebe a tag criada (pendente, sem auto-export)', async () => {
    const { tagId } = await criarTagPendente();
    expect(tagId).toBe('tag-1');
  });

  it('POST /export sem sessão responde 401 LOGIN_REQUIRED', async () => {
    const { tagId } = await criarTagPendente();
    const response = await postJson(started.port, '/export', { tagId });
    expect(response.status).toBe(401);
    expect(response.json['code']).toBe('LOGIN_REQUIRED');
  });

  it('POST /export com sessão exporta e devolve o recibo', async () => {
    const { tagId } = await criarTagPendente();
    const login = await postJson(started.port, '/login', { user: 'analyst', password: 'senha-demo' });
    const response = await postJson(
      started.port,
      '/export',
      { tagId },
      { 'x-session-token': login.json['token'] as string },
    );
    expect(response.status).toBe(200);
    expect(response.json['tagId']).toBe('tag-1');
    expect(response.json['pairCount']).toBe(6);
    expect(response.json['dataSourceId']).toBe('datasource-1');
    expect(response.json['recordId']).toBe('record-1');
  });

  it('POST /export/flush exporta a fila pendente após o login', async () => {
    const { sessionId } = await criarTagPendente();
    await postJson(started.port, `/sessions/${sessionId}/tags`, {
      tagOption: 'link',
      title: 'Vínculo',
      type: 'CaseLink',
      selection: { kind: 'text', startOffset: 11, endOffset: 20 },
    });
    const semLogin = await postJson(started.port, '/export/flush', {});
    expect(semLogin.status).toBe(401);
    const login = await postJson(started.port, '/login', { user: 'analyst', password: 'senha-demo' });
    const flush = await postJson(
      started.port,
      '/export/flush',
      {},
      { 'x-session-token': login.json['token'] as string },
    );
    expect(flush.status).toBe(200);
    expect(flush.json['exported']).toBe(2);
  });

  it('responde 413 (drenando o corpo) acima de 8 MB e 404 em rota desconhecida', async () => {
    const grande = await fetch(`http://localhost:${started.port}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagId: 'x', lixo: 'a'.repeat(MAX_BODY) }),
    });
    expect(grande.status).toBe(413);
    const desconhecida = await postJson(started.port, '/rota-que-nao-existe', {});
    expect(desconhecida.status).toBe(404);
  });

  it('valida corpos malformados e campos obrigatórios', async () => {
    const invalido = await fetch(`http://localhost:${started.port}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'não-é-json',
    });
    expect(invalido.status).toBe(400);
    const semCampo = await postJson(started.port, '/login', { user: 'analyst' });
    expect(semCampo.status).toBe(400);
    const sessaoRuim = await postJson(started.port, '/sessions', {
      bookmarkletId: 'bookmarklet-99',
      url: 'https://x/y',
    });
    expect(sessaoRuim.status).toBe(404);
  });
});
