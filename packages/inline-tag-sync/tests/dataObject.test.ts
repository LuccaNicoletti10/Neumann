/**
 * inline-tag-sync — tests/dataObject.test.ts
 * Testes da geração do data object e da object view (segunda plataforma).
 */
import { describe, expect, it } from 'vitest';

import {
  DATA_OBJECT_TYPE,
  generateDataObject,
  generateObjectView,
  parseTagRefs,
  tagRefsFromDocument,
} from '../src/core/dataObject.js';
import { applyFirstTag } from '../src/core/tagging.js';
import { DOC_NOTE, makeDeps, makeDoc, makeStore, rangeOf } from './helpers.js';

function tagJohnDoe(doc: ReturnType<typeof makeDoc>, store: ReturnType<typeof makeStore>) {
  const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
  return applyFirstTag(
    doc,
    { field: 'note', start, end, objectId: 'obj-john', propertyKey: 'name', userId: 'ana' },
    store,
    makeDeps(),
  );
}

describe('geração do data object', () => {
  it('gera data object a partir das tags do documento', () => {
    const doc = makeDoc();
    const store = makeStore();
    tagJohnDoe(doc, store);
    const dataObject = generateDataObject(doc, store, makeDeps());
    expect(dataObject.type).toBe(DATA_OBJECT_TYPE);
    expect(dataObject.properties['documentId']).toBe('doc-1');
    expect(dataObject.properties['title']).toBe('Relatório semanal');
    expect(dataObject.properties['note']).toBe(DOC_NOTE);
    const refs = parseTagRefs(dataObject);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.objectId).toBe('obj-john');
    expect(refs[0]?.propertyKey).toBe('name');
    expect(refs[0]?.origin).toBe('inline');
    expect(refs[0]?.userId).toBe('ana');
  });

  it('carrega as localizações absolutas das first tags', () => {
    const doc = makeDoc();
    const store = makeStore();
    const { start, end } = rangeOf(DOC_NOTE, 'John Doe');
    tagJohnDoe(doc, store);
    const dataObject = generateDataObject(doc, store, makeDeps());
    const refs = parseTagRefs(dataObject);
    expect(refs[0]?.field).toBe('note');
    expect(refs[0]?.start).toBe(start);
    expect(refs[0]?.end).toBe(end);
  });

  it('regenerar ATUALIZA o mesmo data object (não duplica)', () => {
    const doc = makeDoc();
    const store = makeStore();
    tagJohnDoe(doc, store);
    const deps = makeDeps();
    const first = generateDataObject(doc, store, deps);
    const { start, end } = rangeOf('Cobertura pelo Local News.', 'Local News');
    applyFirstTag(
      doc,
      { field: 'summary', start, end, objectId: 'obj-news', propertyKey: 'title', userId: 'bruno' },
      store,
      deps,
    );
    const second = generateDataObject(doc, store, deps);
    expect(second.id).toBe(first.id);
    expect(parseTagRefs(second)).toHaveLength(2);
    expect(store.listObjects().filter((o) => o.type === DATA_OBJECT_TYPE)).toHaveLength(1);
  });

  it('tagRefsFromDocument converte tags preservando todos os campos', () => {
    const doc = makeDoc();
    const store = makeStore();
    const tag = tagJohnDoe(doc, store);
    const refs = tagRefsFromDocument(doc);
    expect(refs).toEqual([
      {
        tagId: tag.id,
        field: 'note',
        start: tag.start,
        end: tag.end,
        objectId: 'obj-john',
        propertyKey: 'name',
        label: tag.label,
        origin: 'inline',
        userId: 'ana',
      },
    ]);
  });

  it('parseTagRefs de data object sem tags devolve lista vazia', () => {
    const store = makeStore();
    const obj = store.createObject({ type: 'Document', properties: { documentId: 'd' } });
    expect(parseTagRefs(obj)).toEqual([]);
  });

  it('object view resolve trecho, objeto e propriedade de cada tag', () => {
    const doc = makeDoc();
    const store = makeStore();
    tagJohnDoe(doc, store);
    const view = generateObjectView(doc, store, makeDeps());
    expect(view.documentId).toBe('doc-1');
    expect(view.title).toBe('Relatório semanal');
    expect(view.entries).toHaveLength(1);
    const entry = view.entries[0];
    expect(entry?.text).toBe('John Doe');
    expect(entry?.objectLabel).toBe("John Doe's Profile");
    expect(entry?.objectType).toBe('Person');
    expect(entry?.propertyValue).toBe("John Doe's Profile");
  });

  it('documento sem tags gera data object com tags vazias', () => {
    const doc = makeDoc();
    const store = makeStore();
    const dataObject = generateDataObject(doc, store, makeDeps());
    expect(parseTagRefs(dataObject)).toEqual([]);
  });
});
