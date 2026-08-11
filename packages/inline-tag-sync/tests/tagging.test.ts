/**
 * inline-tag-sync — tests/tagging.test.ts
 * Testes da in-line tagging interface: first tags, atalho "@" e novo objeto.
 */
import { describe, expect, it } from 'vitest';

import { getField, insertText } from '../src/core/document.js';
import {
  applyFirstTag,
  applyTagShortcut,
  createNewObjectFor,
  listTags,
  parseShortcut,
  searchForSelection,
  tagsInField,
} from '../src/core/tagging.js';
import { DOC_NOTE, FIXED_NOW, makeDeps, makeDoc, makeStore, rangeOf } from './helpers.js';

describe('in-line tagging interface', () => {
  it('aplica first tag in-line vinculando trecho a propriedade de objeto', () => {
    const doc = makeDoc();
    const store = makeStore();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    const tag = applyFirstTag(
      doc,
      { field: 'note', start, end, objectId: 'obj-john', propertyKey: 'name', userId: 'ana' },
      store,
      makeDeps(),
    );
    expect(tag.id).toBe('tag-1');
    expect(tag.origin).toBe('inline');
    expect(tag.userId).toBe('ana');
    expect(tag.label).toBe("Name: John Doe's Profile");
    expect(tag.createdAt).toBe(FIXED_NOW);
    expect(doc.tags).toHaveLength(1);
    expect(doc.revisions.at(-1)?.action).toBe('tag');
  });

  it('rejeita trecho vazio e intervalo inválido', () => {
    const doc = makeDoc();
    const store = makeStore();
    expect(() =>
      applyFirstTag(
        doc,
        { field: 'note', start: 4, end: 4, objectId: 'obj-john', propertyKey: 'name' },
        store,
      ),
    ).toThrow(/não pode ser vazio/);
    expect(() =>
      applyFirstTag(
        doc,
        { field: 'note', start: 0, end: 9999, objectId: 'obj-john', propertyKey: 'name' },
        store,
      ),
    ).toThrow(/intervalo inválido/);
  });

  it('rejeita objeto inexistente e propriedade inexistente', () => {
    const doc = makeDoc();
    const store = makeStore();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    expect(() =>
      applyFirstTag(
        doc,
        { field: 'note', start, end, objectId: 'obj-zzz', propertyKey: 'name' },
        store,
      ),
    ).toThrow(/objeto não encontrado/);
    expect(() =>
      applyFirstTag(
        doc,
        { field: 'note', start, end, objectId: 'obj-john', propertyKey: 'phone' },
        store,
      ),
    ).toThrow(/não possui a propriedade "phone"/);
  });

  it('rejeita tags sobrepostas no mesmo campo', () => {
    const doc = makeDoc();
    const store = makeStore();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    applyFirstTag(
      doc,
      { field: 'note', start, end, objectId: 'obj-john', propertyKey: 'name' },
      store,
    );
    expect(() =>
      applyFirstTag(
        doc,
        { field: 'note', start: start + 2, end: end + 2, objectId: 'obj-john', propertyKey: 'email' },
        store,
      ),
    ).toThrow(/sobrepõe a tag/);
  });

  it('permite tags adjacentes (sem sobreposição)', () => {
    const doc = makeDoc();
    const store = makeStore();
    applyFirstTag(
      doc,
      { field: 'note', start: 0, end: 7, objectId: 'obj-john', propertyKey: 'name' },
      store,
    );
    const tag = applyFirstTag(
      doc,
      { field: 'note', start: 9, end: 17, objectId: 'obj-john', propertyKey: 'email' },
      store,
    );
    expect(tag.start).toBe(9);
    expect(doc.tags).toHaveLength(2);
  });

  it('busca objetos relacionados ao trecho selecionado', () => {
    const doc = makeDoc();
    const store = makeStore();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    const results = searchForSelection(doc, 'note', start, end, store);
    expect(results.map((r) => r.label)).toEqual(["John Doe's Profile"]);
  });

  it('parseShortcut localiza o último "@" e a consulta até o fim', () => {
    expect(parseShortcut('fale com @John Doe')).toEqual({
      at: 9,
      end: 18,
      query: 'John Doe',
    });
    expect(parseShortcut('sem atalho aqui')).toBeNull();
    expect(parseShortcut('terminou em @')).toBeNull();
  });

  it('atalho "@" SUBSTITUI o user input pela tag (Email: ...)', () => {
    const doc = makeDoc();
    const store = makeStore();
    insertText(doc, 'note', DOC_NOTE.length, ' Enviar para @John Doe', 'ana', makeDeps());
    const result = applyTagShortcut(
      doc,
      'note',
      { objectId: 'obj-john', propertyKey: 'email', userId: 'ana' },
      store,
      makeDeps(),
    );
    expect(result.tag.label).toBe('Email: johndoe@email.com');
    expect(getField(doc, 'note').text).toBe(
      'Contato: John Doe esteve no evento. Enviar para Email: johndoe@email.com',
    );
    // A tag cobre exatamente o texto substituído.
    const tag = result.tag;
    expect(getField(doc, 'note').text.slice(tag.start, tag.end)).toBe(
      'Email: johndoe@email.com',
    );
    expect(tag.origin).toBe('inline');
    expect(doc.revisions.some((r) => r.action === 'shortcut')).toBe(true);
  });

  it('atalho "@" falha sem "@" pendente no campo', () => {
    const doc = makeDoc();
    const store = makeStore();
    expect(() =>
      applyTagShortcut(doc, 'note', { objectId: 'obj-john', propertyKey: 'email' }, store),
    ).toThrow(/nenhum atalho "@" pendente/);
  });

  it('cria NOVO objeto/tag para o trecho ("Create New Object for X")', () => {
    const doc = makeDoc();
    const store = makeStore();
    const { start, end } = rangeOf(DOC_NOTE, 'evento');
    const { object, tag } = createNewObjectFor(
      doc,
      { field: 'note', start, end, type: 'Event', userId: 'ana' },
      store,
      makeDeps(),
    );
    expect(object.type).toBe('Event');
    expect(object.properties['name']).toBe('evento');
    expect(tag.objectId).toBe(object.id);
    expect(tag.propertyKey).toBe('name');
    expect(tag.origin).toBe('inline');
  });

  it('lista tags do documento e por campo em ordem estável', () => {
    const doc = makeDoc();
    const store = makeStore();
    const deps = makeDeps();
    applyFirstTag(
      doc,
      { field: 'note', start: 9, end: 17, objectId: 'obj-john', propertyKey: 'name' },
      store,
      deps,
    );
    applyFirstTag(
      doc,
      { field: 'summary', start: 15, end: 25, objectId: 'obj-news', propertyKey: 'title' },
      store,
      deps,
    );
    expect(listTags(doc).map((t) => t.field)).toEqual(['note', 'summary']);
    expect(tagsInField(doc, 'note')).toHaveLength(1);
    expect(tagsInField(doc, 'title')).toHaveLength(0);
  });
});
