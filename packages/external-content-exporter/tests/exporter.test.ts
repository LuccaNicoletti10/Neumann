/**
 * external-content-exporter — tests/exporter.test.ts
 * Testes dos mecanismos 6 (EXPORTAÇÃO), 7 (CONVERSÃO) e 8 (combinações).
 */
import { describe, expect, it } from 'vitest';

import { convertToInternalFormat, INTERNAL_FORMAT, toParameterValuePairs } from '../src/core/exporter.js';
import { CoreError } from '../src/core/types.js';
import { makeStack, makeTag, sampleSession } from './helpers.js';

describe('conversão (passo 530 + internal database API)', () => {
  it('gera os pares parâmetro-valor exatos, na ordem da API', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session, 'Suspeito');
    expect(toParameterValuePairs(tag)).toEqual([
      { parameter: 'TagOption', value: 'object' },
      { parameter: 'Title', value: 'Suspeito' },
      { parameter: 'Type', value: 'Person' },
      { parameter: 'Content', value: tag.contentLabel },
      { parameter: 'DateAdded', value: '2024-01-01T00:00:00.000Z' },
      { parameter: 'User', value: 'analyst' },
    ]);
  });

  it('DateAdded dos pares vem do clock injetado (não do relógio do sistema)', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const primeira = makeTag(stack, session, 'A');
    const segunda = makeTag(stack, session, 'B');
    expect(primeira.dateAdded).toBe('2024-01-01T00:00:00.000Z');
    expect(segunda.dateAdded).toBe('2024-01-01T00:00:01.000Z');
  });

  it('convertToInternalFormat empacota pares + conteúdo no formato compatível', () => {
    const stack = makeStack();
    const { session, content } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const pkg = convertToInternalFormat(toParameterValuePairs(tag), content);
    expect(pkg.format).toBe(INTERNAL_FORMAT);
    expect(pkg.pairs).toHaveLength(6);
    expect(pkg.content.label).toBe(content.label);
  });

  it('convertToInternalFormat rejeita lista vazia de pares', () => {
    const stack = makeStack();
    const { content } = sampleSession(stack);
    expect(() => convertToInternalFormat([], content)).toThrow(/conversão exige ao menos um par/);
  });
});

describe('exportação (passo 530)', () => {
  it('export sem login falha com LOGIN_REQUIRED', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    try {
      stack.exporter.exportTag(undefined, tag.id);
      expect.unreachable();
    } catch (error) {
      expect((error as CoreError).code).toBe('LOGIN_REQUIRED');
    }
    // A tag permanece pendente após a tentativa sem login.
    expect(stack.tagStore.pendingQueue()).toHaveLength(1);
  });

  it('botão de export envia tag + conteúdo para o internal database system', () => {
    const stack = makeStack();
    const { session, content } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const login = stack.auth.login('analyst', 'senha-demo');
    const receipt = stack.exporter.exportTag(login.token, tag.id);
    expect(receipt.tagId).toBe(tag.id);
    expect(receipt.contentLabel).toBe(content.label);
    expect(receipt.pairCount).toBe(6);
    expect(receipt.storage).toBe('internal');
    // Clock: dateAdded da tag (1ª), createdAt do login (2ª), exportação (3ª).
    expect(receipt.exportedAt).toBe('2024-01-01T00:00:02.000Z');
    expect(stack.tagStore.pendingQueue()).toHaveLength(0);
    expect(stack.internalDb.queryByLabel(content.label)).toHaveLength(1);
  });

  it('retainExternal=true registra armazenamento "both"', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const login = stack.auth.login('analyst', 'senha-demo');
    const receipt = stack.exporter.exportTag(login.token, tag.id, { retainExternal: true });
    expect(receipt.storage).toBe('both');
    expect(stack.tagStore.storageOf(tag.id)).toBe('both');
  });

  it('exporta conteúdo junto: data source guarda o conteúdo do cache local', () => {
    const stack = makeStack();
    const { session, content } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const login = stack.auth.login('analyst', 'senha-demo');
    const receipt = stack.exporter.exportTag(login.token, tag.id);
    expect(stack.internalDb.getDataSource(receipt.dataSourceId)?.content.body).toBe(content.body);
  });

  it('falha se o conteúdo não estiver no cache local (CONTENT_NOT_FOUND)', () => {
    const stack = makeStack();
    const { session, content } = sampleSession(stack);
    const tag = makeTag(stack, session);
    stack.tagStore.contentCache.remove(content.label);
    const login = stack.auth.login('analyst', 'senha-demo');
    expect(() => stack.exporter.exportTag(login.token, tag.id)).toThrow(/conteúdo não encontrado no cache local/);
  });

  it('falha para tag inexistente (TAG_NOT_FOUND)', () => {
    const stack = makeStack();
    const login = stack.auth.login('analyst', 'senha-demo');
    expect(() => stack.exporter.exportTag(login.token, 'tag-99')).toThrow(/tag pendente não encontrada/);
  });

  it('AUTO-EXPORT: criação da tag dispara exportação automática com sessão ativa', () => {
    const stack = makeStack({ autoExportOnCreate: true });
    stack.auth.login('analyst', 'senha-demo');
    const { session, content } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'object', title: 'Auto', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 3 },
    );
    const receipt = stack.exporter.receiveTag(tag);
    expect(receipt).toBeDefined();
    expect(receipt?.tagId).toBe(tag.id);
    expect(stack.tagStore.pendingQueue()).toHaveLength(0);
    expect(stack.internalDb.queryByLabel(content.label)).toHaveLength(1);
  });

  it('AUTO-EXPORT sem sessão apenas enfileira (exporta depois, ao logar)', () => {
    const stack = makeStack({ autoExportOnCreate: true });
    const { session } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'object', title: 'Offline', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 3 },
    );
    expect(stack.exporter.receiveTag(tag)).toBeUndefined();
    expect(stack.tagStore.pendingQueue()).toHaveLength(1);
    const login = stack.auth.login('analyst', 'senha-demo');
    const receipts = stack.exporter.flushPending(login.token);
    expect(receipts).toHaveLength(1);
    expect(stack.tagStore.pendingQueue()).toHaveLength(0);
  });

  it('flushPending exporta toda a fila pendente após o login (device conectou)', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    makeTag(stack, session, 'A');
    makeTag(stack, session, 'B');
    makeTag(stack, session, 'C');
    expect(stack.tagStore.pendingQueue()).toHaveLength(3);
    const login = stack.auth.login('analyst', 'senha-demo');
    const receipts = stack.exporter.flushPending(login.token);
    expect(receipts.map((receipt) => receipt.tagId)).toEqual(['tag-1', 'tag-2', 'tag-3']);
    expect(stack.tagStore.pendingQueue()).toHaveLength(0);
    expect(stack.internalDb.listRecords()).toHaveLength(3);
  });

  it('flushPending sem login falha e mantém a fila intacta', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    makeTag(stack, session);
    expect(() => stack.exporter.flushPending(undefined)).toThrow(/LOGIN_REQUIRED|exige login/);
    expect(stack.tagStore.pendingQueue()).toHaveLength(1);
  });

  it('receiveTag sem AUTO-EXPORT apenas armazena localmente', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'property', title: 'Local', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 2 },
    );
    expect(stack.exporter.receiveTag(tag)).toBeUndefined();
    expect(stack.tagStore.pendingQueue()).toHaveLength(1);
    expect(stack.internalDb.listRecords()).toHaveLength(0);
  });
});
