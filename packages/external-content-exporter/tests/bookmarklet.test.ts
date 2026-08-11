/**
 * external-content-exporter — tests/bookmarklet.test.ts
 * Testes do mecanismo 1 (BOOKMARKLET) e 3 (ENHANCE/ativação).
 */
import { describe, expect, it } from 'vitest';

import {
  activate,
  buildBookmarkletUrl,
  createBookmarkBar,
  createBookmarklet,
  createPlugin,
} from '../src/core/bookmarklet.js';
import { createIdGenerator } from '../src/core/determinism.js';

describe('bookmarklet (passo 505)', () => {
  it('cria bookmark contendo comandos JavaScript', () => {
    const bookmarklet = createBookmarklet('Taguear', ['cmd1()', 'cmd2()']);
    expect(bookmarklet.commands).toEqual(['cmd1()', 'cmd2()']);
    expect(bookmarklet.kind).toBe('bookmarklet');
  });

  it('gera a URL javascript:... a partir dos comandos', () => {
    const bookmarklet = createBookmarklet('Taguear', ['exibirTaggingInterface()']);
    expect(bookmarklet.url).toBe(
      `javascript:${encodeURIComponent('exibirTaggingInterface()')}`,
    );
    expect(bookmarklet.url.startsWith('javascript:')).toBe(true);
  });

  it('buildBookmarkletUrl junta múltiplos comandos com ponto-e-vírgula', () => {
    expect(buildBookmarkletUrl(['a()', 'b()'])).toBe(`javascript:${encodeURIComponent('a();b()')}`);
  });

  it('gera ids determinísticos por contador (bookmarklet-1, bookmarklet-2)', () => {
    const nextId = createIdGenerator();
    const primeiro = createBookmarklet('Um', ['a()'], { nextId });
    const segundo = createBookmarklet('Dois', ['b()'], { nextId });
    expect(primeiro.id).toBe('bookmarklet-1');
    expect(segundo.id).toBe('bookmarklet-2');
  });

  it('rejeita bookmarklet sem comandos JavaScript', () => {
    expect(() => createBookmarklet('Vazio', [])).toThrow(/ao menos um comando/);
  });

  it('rejeita nome vazio', () => {
    expect(() => createBookmarklet('   ', ['a()'])).toThrow(/nome do bookmarklet/);
  });

  it('instala na barra de bookmarks por drag-and-drop (default)', () => {
    const bar = createBookmarkBar();
    const bookmarklet = createBookmarklet('Taguear', ['a()']);
    const entry = bar.install(bookmarklet);
    expect(entry.method).toBe('drag-and-drop');
    expect(entry.position).toBe(1);
    expect(bar.entries()).toHaveLength(1);
  });

  it('suporta instalação por atalho e por importação', () => {
    const bar = createBookmarkBar({ browser: 'browser-x' });
    bar.install(createBookmarklet('A', ['a()']), 'shortcut');
    bar.install(createBookmarklet('B', ['b()']), 'import');
    expect(bar.entries().map((entry) => entry.method)).toEqual(['shortcut', 'import']);
    expect(bar.find('B')?.bookmarklet.name).toBe('B');
  });

  it('plug-in é a alternativa específica por browser', () => {
    const nextId = createIdGenerator();
    const plugin = createPlugin('Tagger', 'browser-y', ['a()'], { nextId });
    expect(plugin.kind).toBe('plugin');
    expect(plugin.browser).toBe('browser-y');
    expect(plugin.id).toBe('plugin-1');
    expect(() => createPlugin('Tagger', ' ', ['a()'])).toThrow(/browser específico/);
  });

  it('ativação melhora o browser exibindo a tagging interface', () => {
    const bookmarklet = createBookmarklet('Taguear', ['a()']);
    const activation = activate(bookmarklet);
    expect(activation.taggingInterfaceVisible).toBe(true);
    expect(activation.extensionKind).toBe('bookmarklet');
    expect(activation.commands).toEqual(['a()']);
  });

  it('ativação também funciona com plug-in', () => {
    const plugin = createPlugin('Tagger', 'browser-y', ['b()']);
    const activation = activate(plugin);
    expect(activation.extensionKind).toBe('plugin');
    expect(activation.taggingInterfaceVisible).toBe(true);
  });
});
