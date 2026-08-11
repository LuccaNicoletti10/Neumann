/**
 * inline-tag-sync — tests/render.test.ts
 * Testes das visões in-line (marcador de tag) e object-based (negrito/sublinhado).
 */
import { describe, expect, it } from 'vitest';

import {
  renderInlineView,
  renderObjectBasedView,
  renderTagDetails,
} from '../src/core/render.js';
import { applyFirstTag } from '../src/core/tagging.js';
import { DOC_NOTE, makeDeps, makeDoc, makeStore, rangeOf } from './helpers.js';

function cenario() {
  const doc = makeDoc();
  const store = makeStore();
  const deps = makeDeps();
  const range = rangeOf(DOC_NOTE, 'John Doe');
  const tag = applyFirstTag(
    doc,
    { field: 'note', start: range.start, end: range.end, objectId: 'obj-john', propertyKey: 'email', userId: 'ana' },
    store,
    deps,
  );
  return { doc, store, deps, tag };
}

describe('renderização das visões', () => {
  it('visão in-line envolve trecho tagueado com marcador [TAG:Tipo/Prop]', () => {
    const { doc, store } = cenario();
    const view = renderInlineView(doc, store);
    expect(view).toContain('[TAG:Person/Email]John Doe[/TAG]');
  });

  it('visão in-line mantém texto não-tagueado sem marcador', () => {
    const { doc, store } = cenario();
    const view = renderInlineView(doc, store);
    expect(view).toContain('Contato: ');
    expect(view).toContain(' esteve no evento.');
    expect(view).not.toContain('[TAG:Person/Email]Contato');
  });

  it('visão object-based exibe trechos tagueados em negrito/sublinhado', () => {
    const { doc, store } = cenario();
    const view = renderObjectBasedView(doc, store);
    expect(view).toContain('**__John Doe__**');
    expect(view).not.toContain('[/TAG]');
  });

  it('ambas as visões incluem os rótulos dos campos', () => {
    const { doc, store } = cenario();
    for (const view of [renderInlineView(doc, store), renderObjectBasedView(doc, store)]) {
      expect(view).toContain('## Título');
      expect(view).toContain('## Resumo');
      expect(view).toContain('## Anotação');
    }
  });

  it('detalhes da tag mostram objeto, propriedade tagueada e demais propriedades', () => {
    const { doc, store, tag } = cenario();
    const details = renderTagDetails(doc, tag.id, store);
    expect(details).toContain('Trecho: "John Doe" (campo note');
    expect(details).toContain('Origem da tag: inline (aplicada por ana)');
    expect(details).toContain("Objeto: John Doe's Profile [Person] (obj-john)");
    expect(details).toContain('Propriedade tagueada: Email = johndoe@email.com');
    expect(details).toContain('  - role: Analista');
  });

  it('detalhes de tag inexistente falham', () => {
    const { doc, store } = cenario();
    expect(() => renderTagDetails(doc, 'tag-zzz', store)).toThrow(/tag não encontrada/);
  });

  it('visão object-based mantém texto não-tagueado sem formatação', () => {
    const { doc, store } = cenario();
    const view = renderObjectBasedView(doc, store);
    expect(view).toContain('Contato: **__John Doe__** esteve no evento.');
  });
});
