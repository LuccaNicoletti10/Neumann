/**
 * external-content-exporter — tests/content.test.ts
 * Testes do mecanismo 2 (ACESSO A CONTEÚDO EXTERNO), 3 (ENHANCE) e 5 (label).
 */
import { describe, expect, it } from 'vitest';

import {
  accessExternalContent,
  createWebBrowser,
  defaultTransport,
  enhanceLocalCopy,
  inferContentType,
  labelContent,
  SELECTION_MARKUP,
} from '../src/core/content.js';
import { createIdGenerator } from '../src/core/determinism.js';
import { createTagStore } from '../src/core/tagStore.js';
import { CoreError } from '../src/core/types.js';

describe('acesso a conteúdo externo (passo 510)', () => {
  it('acessa conteúdo servido por server externo via network e abre no browser', () => {
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, 'https://externo.example.com/pagina.html');
    expect(content.sourceServer).toBe('externo.example.com');
    expect(content.contentType).toBe('web-page');
    expect(browser.current()?.id).toBe(content.id);
  });

  it('gera ids/labels determinísticos (content-1, content-2)', () => {
    const nextId = createIdGenerator();
    const browser = createWebBrowser();
    const primeiro = accessExternalContent(browser, 'https://a.example.com/x', { nextId });
    const segundo = accessExternalContent(browser, 'https://b.example.com/y', { nextId });
    expect(primeiro.id).toBe('content-1');
    expect(primeiro.label).toBe('content-1');
    expect(segundo.id).toBe('content-2');
  });

  it('infere todos os tipos de conteúdo externo suportados', () => {
    expect(inferContentType('https://s/a.html')).toBe('web-page');
    expect(inferContentType('https://s/a.pdf')).toBe('pdf');
    expect(inferContentType('https://s/a.mp3')).toBe('audio');
    expect(inferContentType('https://s/a.mp4')).toBe('video');
    expect(inferContentType('https://s/a.png')).toBe('image');
    expect(inferContentType('https://s/a.eml')).toBe('email');
    expect(inferContentType('https://s/a.form')).toBe('form');
    expect(inferContentType('https://s/a.txt')).toBe('document');
  });

  it('usa transporte injetável (server externo simulado)', () => {
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, 'https://intranet/doc', {
      transport: () => ({ body: 'PDF binário', contentType: 'pdf', sourceServer: 'srv-externo' }),
    });
    expect(content.body).toBe('PDF binário');
    expect(content.contentType).toBe('pdf');
    expect(content.sourceServer).toBe('srv-externo');
  });

  it('rejeita URL vazia e tipo de conteúdo inválido do transporte', () => {
    const browser = createWebBrowser();
    expect(() => accessExternalContent(browser, ' ')).toThrow(CoreError);
    expect(() =>
      accessExternalContent(browser, 'https://s/x', {
        transport: () => ({
          body: '',
          contentType: 'estranho' as never,
          sourceServer: 's',
        }),
      }),
    ).toThrow(/INVALID_CONTENT_TYPE|tipo de conteúdo não suportado/);
  });

  it('transporte default é determinístico para a mesma URL', () => {
    expect(defaultTransport('https://h/x')).toEqual(defaultTransport('https://h/x'));
  });
});

describe('enhance do browser (passo 515) e label no cache (passo 525)', () => {
  it('enhanceLocalCopy injeta marcação de suporte à seleção na cópia local', () => {
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, 'https://s/pagina');
    const enhanced = enhanceLocalCopy(content, ['exibirTaggingInterface()']);
    expect(enhanced.enhanced).toBe(true);
    expect(enhanced.content.body).toContain(SELECTION_MARKUP);
    expect(enhanced.appliedCommands).toEqual(['exibirTaggingInterface()']);
    // O original não é modificado (cópia local separada).
    expect(content.body.includes(SELECTION_MARKUP)).toBe(false);
  });

  it('labelContent armazena o conteúdo sob um label no cache local', () => {
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, 'https://s/pagina');
    const store = createTagStore();
    const label = labelContent(content, store.contentCache, 'relatorio-42');
    expect(label).toBe('relatorio-42');
    expect(store.contentCache.getContent('relatorio-42')?.label).toBe('relatorio-42');
    expect(store.contentCache.labels()).toEqual(['relatorio-42']);
  });

  it('labelContent usa o label do próprio conteúdo como default', () => {
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, 'https://s/pagina');
    const store = createTagStore();
    expect(labelContent(content, store.contentCache)).toBe(content.label);
    expect(store.contentCache.getContent(content.label)?.id).toBe(content.id);
  });

  it('labelContent rejeita label vazio', () => {
    const browser = createWebBrowser();
    const content = accessExternalContent(browser, 'https://s/pagina');
    const store = createTagStore();
    expect(() => labelContent(content, store.contentCache, ' ')).toThrow(/label do conteúdo não pode ser vazio/);
  });
});
