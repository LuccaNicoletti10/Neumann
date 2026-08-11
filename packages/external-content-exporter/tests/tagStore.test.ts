/**
 * external-content-exporter — tests/tagStore.test.ts
 * Testes do mecanismo 5 (ARMAZENAMENTO LOCAL) e 8 (combinações).
 */
import { describe, expect, it } from 'vitest';

import { createTagStore } from '../src/core/tagStore.js';
import { CoreError } from '../src/core/types.js';
import { makeStack, makeTag, sampleSession } from './helpers.js';

describe('armazenamento local (passo 525)', () => {
  it('salva a tag recebida na memória do electronic device (default)', () => {
    const store = createTagStore();
    expect(store.location).toBe('device-memory');
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    store.saveTag(tag);
    expect(store.pendingQueue().map((t) => t.id)).toEqual([tag.id]);
  });

  it('suporta o cache do browser como local externo alternativo', () => {
    const store = createTagStore({ location: 'browser-cache' });
    expect(store.location).toBe('browser-cache');
  });

  it('fila de pendentes preserva a ordem de criação', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const primeiro = makeTag(stack, session, 'A');
    const segundo = makeTag(stack, session, 'B');
    const store = createTagStore();
    store.saveTag(primeiro);
    store.saveTag(segundo);
    expect(store.pendingQueue().map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('rejeita tag duplicada na fila', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const store = createTagStore();
    store.saveTag(tag);
    expect(() => store.saveTag(tag)).toThrow(CoreError);
    expect(() => store.saveTag(tag)).toThrow(/tag já armazenada/);
  });

  it('markExported remove da fila e marca armazenamento interno', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const store = createTagStore();
    store.saveTag(tag);
    expect(store.storageOf(tag.id)).toBe('external');
    expect(store.markExported(tag.id)).toBe(true);
    expect(store.pendingQueue()).toHaveLength(0);
    expect(store.storageOf(tag.id)).toBe('internal');
    expect(store.markExported(tag.id)).toBe(false);
  });

  it('cache de conteúdo armazena e recupera por label', () => {
    const stack = makeStack();
    const { content } = sampleSession(stack);
    const store = createTagStore();
    store.contentCache.storeContent(content.label, content);
    expect(store.contentCache.getContent(content.label)?.url).toBe(content.url);
    expect(store.contentCache.remove(content.label)).toBe(true);
    expect(store.contentCache.getContent(content.label)).toBeUndefined();
    expect(store.contentCache.remove(content.label)).toBe(false);
  });

  it('devolve cópias defensivas (mutação externa não afeta a fila)', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const store = createTagStore();
    store.saveTag(tag);
    const [copia] = store.pendingQueue();
    if (copia !== undefined) copia.title = 'adulterado';
    expect(store.getTag(tag.id)?.title).toBe(tag.title);
  });

  it('combinações de armazenamento: externo, interno ou ambos', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const store = createTagStore();
    store.saveTag(tag);
    expect(store.storageOf(tag.id)).toBe('external');
    store.markExported(tag.id);
    expect(store.storageOf(tag.id)).toBe('internal');
    store.setStorage(tag.id, 'both');
    expect(store.storageOf(tag.id)).toBe('both');
  });
});
