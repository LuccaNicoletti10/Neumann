/**
 * inline-tag-sync — tests/sync.test.ts
 * Testes da sincronização entre plataformas, re-edição sem deslocamento e
 * colaboração (comentários e histórico de revisões).
 */
import { describe, expect, it } from 'vitest';

import { generateDataObject, parseTagRefs } from '../src/core/dataObject.js';
import { getField, insertText } from '../src/core/document.js';
import {
  addEditComment,
  applySecondTag,
  editSessionField,
  isSynchronized,
  reloadDocumentForEditing,
  revisionHistory,
  synchronizeEdits,
} from '../src/core/sync.js';
import { applyFirstTag } from '../src/core/tagging.js';
import { DOC_NOTE, FIXED_NOW, makeDeps, makeDoc, makeStore, rangeOf } from './helpers.js';

function docTagueado() {
  const doc = makeDoc();
  const store = makeStore();
  const deps = makeDeps();
  const john = rangeOf(DOC_NOTE, 'John Doe');
  applyFirstTag(
    doc,
    { field: 'note', start: john.start, end: john.end, objectId: 'obj-john', propertyKey: 'name', userId: 'ana' },
    store,
    deps,
  );
  const news = rangeOf(getField(doc, 'summary').text, 'Local News');
  applyFirstTag(
    doc,
    { field: 'summary', start: news.start, end: news.end, objectId: 'obj-news', propertyKey: 'title', userId: 'ana' },
    store,
    deps,
  );
  const dataObject = generateDataObject(doc, store, deps);
  return { doc, store, deps, dataObject };
}

describe('sincronização entre plataformas', () => {
  it('second tag via object-based ATUALIZA o data object e o documento', () => {
    const { doc, store, deps } = docTagueado();
    insertText(doc, 'note', getField(doc, 'note').text.length, ' Ver Local News.', 'bruno', deps);
    const range = rangeOf(getField(doc, 'note').text, 'Local News');
    const { tag, dataObject } = applySecondTag(
      doc,
      { field: 'note', start: range.start, end: range.end, objectId: 'obj-news', propertyKey: 'title', userId: 'bruno' },
      store,
      deps,
    );
    expect(tag.origin).toBe('object-based');
    expect(tag.userId).toBe('bruno');
    // Documento recebeu a tag...
    expect(doc.tags).toHaveLength(3);
    // ...e o data object foi atualizado com TODAS as tags.
    const refs = parseTagRefs(dataObject);
    expect(refs).toHaveLength(3);
    expect(refs.filter((r) => r.origin === 'object-based')).toHaveLength(1);
    expect(isSynchronized(doc, store)).toBe(true);
  });

  it('sincronização é bidirecional: first tags chegam ao objeto, second tags ao documento', () => {
    const { doc, store, deps } = docTagueado();
    // First tags (inline) já estão no data object.
    let dataObject = store.findByProperty('documentId', doc.id);
    expect(parseTagRefs(dataObject!).filter((r) => r.origin === 'inline')).toHaveLength(2);
    // Second tag aplicada na interface object-based aparece no documento.
    const news = rangeOf(getField(doc, 'summary').text, 'Local News');
    void news;
    insertText(doc, 'title', getField(doc, 'title').text.length, ' (Local News)', 'bruno', deps);
    const range = rangeOf(getField(doc, 'title').text, 'Local News');
    const result = applySecondTag(
      doc,
      { field: 'title', start: range.start, end: range.end, objectId: 'obj-news', propertyKey: 'topic', userId: 'bruno' },
      store,
      deps,
    );
    expect(doc.tags.some((t) => t.origin === 'object-based' && t.field === 'title')).toBe(true);
    dataObject = result.dataObject;
    expect(parseTagRefs(dataObject)).toHaveLength(3);
  });

  it('second tag exige data object já gerado para o documento', () => {
    const doc = makeDoc();
    const store = makeStore();
    const range = rangeOf(DOC_NOTE, 'John Doe');
    expect(() =>
      applySecondTag(
        doc,
        { field: 'note', start: range.start, end: range.end, objectId: 'obj-john', propertyKey: 'name' },
        store,
      ),
    ).toThrow(/gere o data object antes/);
  });

  it('reload identifica localizações absolutas e REMOVE todas as tags', () => {
    const { store, dataObject } = docTagueado();
    const session = reloadDocumentForEditing(dataObject.id, store, makeDeps());
    expect(session.absoluteLocations).toHaveLength(2);
    expect(session.document.tags).toEqual([]);
    expect(session.document.id).toBe('doc-1');
    expect(getField(session.document, 'note').text).toBe(DOC_NOTE);
    // Localizações absolutas ordenadas por campo/offset.
    expect(session.absoluteLocations[0]?.field).toBe('note');
    expect(session.absoluteLocations[1]?.field).toBe('summary');
  });

  it('reload falha para objeto que não é data object de documento', () => {
    const store = makeStore();
    expect(() => reloadDocumentForEditing('obj-john', store)).toThrow(/documentId/);
  });

  it('edição após reload NÃO desloca tags: re-aplicação nas localizações absolutas', () => {
    const { store, dataObject } = docTagueado();
    const deps = makeDeps();
    const session = reloadDocumentForEditing(dataObject.id, store, deps);
    const before = session.absoluteLocations.map((l) => ({ ...l }));
    // Edição livre do texto durante a sessão (tags removidas: nada a deslocar).
    editSessionField(
      session,
      'note',
      'Contato: John Doe esteve no evento. Confirmado por telefone.',
      'ana',
      deps,
    );
    expect(session.document.tags).toEqual([]);
    const { document, dataObject: updated } = synchronizeEdits(session, store, deps);
    // Todas as tags re-aplicadas EXATAMENTE nas localizações absolutas originais.
    expect(document.tags).toHaveLength(before.length);
    for (const [index, location] of before.entries()) {
      const tag = document.tags[index];
      expect(tag?.id).toBe(location.tagId);
      expect(tag?.field).toBe(location.field);
      expect(tag?.start).toBe(location.start);
      expect(tag?.end).toBe(location.end);
      expect(tag?.objectId).toBe(location.objectId);
      expect(tag?.origin).toBe(location.origin);
    }
    // Edição sincronizada com o data object.
    expect(updated.properties['note']).toBe(
      'Contato: John Doe esteve no evento. Confirmado por telefone.',
    );
    expect(isSynchronized(document, store)).toBe(true);
  });

  it('synchronizeEdits registra revisão de sync no histórico', () => {
    const { store, dataObject } = docTagueado();
    const session = reloadDocumentForEditing(dataObject.id, store, makeDeps());
    const { document } = synchronizeEdits(session, store, makeDeps());
    const actions = revisionHistory(document).map((r) => r.action);
    expect(actions).toContain('reload');
    expect(actions).toContain('sync');
  });

  it('synchronizeEdits falha se edição removeu texto além de uma localização absoluta', () => {
    const { store, dataObject } = docTagueado();
    const session = reloadDocumentForEditing(dataObject.id, store, makeDeps());
    editSessionField(session, 'note', 'curto', 'ana', makeDeps());
    expect(() => synchronizeEdits(session, store, makeDeps())).toThrow(/fora do texto editado/);
  });

  it('addEditComment associa motivo/comentário ao documento com userId', () => {
    const { doc } = docTagueado();
    const comment = addEditComment(doc, 'bruno', 'aprovado para publicação', makeDeps());
    expect(comment.id).toBe('cmt-1');
    expect(comment.documentId).toBe('doc-1');
    expect(comment.userId).toBe('bruno');
    expect(comment.at).toBe(FIXED_NOW);
    expect(doc.comments).toHaveLength(1);
    expect(doc.revisions.at(-1)?.action).toBe('comment');
  });

  it('addEditComment rejeita comentário vazio', () => {
    const { doc } = docTagueado();
    expect(() => addEditComment(doc, 'bruno', '   ')).toThrow(/não pode ser vazio/);
  });

  it('isSynchronized é falso sem data object ou com tags divergentes', () => {
    const doc = makeDoc();
    const store = makeStore();
    expect(isSynchronized(doc, store)).toBe(false);
    const deps = makeDeps();
    generateDataObject(doc, store, deps);
    expect(isSynchronized(doc, store)).toBe(true);
    const range = rangeOf(DOC_NOTE, 'John Doe');
    applyFirstTag(
      doc,
      { field: 'note', start: range.start, end: range.end, objectId: 'obj-john', propertyKey: 'name' },
      store,
      deps,
    );
    expect(isSynchronized(doc, store)).toBe(false);
  });
});
