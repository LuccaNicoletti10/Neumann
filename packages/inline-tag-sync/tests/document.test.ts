/**
 * inline-tag-sync — tests/document.test.ts
 * Testes do modelo do documento (criação, edição por offsets, leitura de trecho).
 */
import { describe, expect, it } from 'vitest';

import {
  createDocument,
  getField,
  insertText,
  isDocumentFieldId,
  readRange,
  removeText,
  setFieldText,
} from '../src/core/document.js';
import { FIXED_NOW, makeDeps, makeDoc } from './helpers.js';

describe('modelo do documento', () => {
  it('cria documento com os campos title, summary e note', () => {
    const doc = createDocument(
      { id: 'doc-x', title: 'T', summary: 'S', note: 'N', userId: 'ana' },
      makeDeps(),
    );
    expect(doc.id).toBe('doc-x');
    expect(getField(doc, 'title').text).toBe('T');
    expect(getField(doc, 'summary').text).toBe('S');
    expect(getField(doc, 'note').text).toBe('N');
    expect(doc.createdBy).toBe('ana');
    expect(doc.createdAt).toBe(FIXED_NOW);
    expect(doc.tags).toEqual([]);
  });

  it('gera id determinístico sequencial quando não informado', () => {
    const deps = makeDeps();
    const a = createDocument({}, deps);
    const b = createDocument({}, deps);
    expect(a.id).toBe('doc-1');
    expect(b.id).toBe('doc-2');
  });

  it('registra revisão de criação no histórico', () => {
    const doc = makeDoc();
    expect(doc.revisions).toHaveLength(1);
    expect(doc.revisions[0]?.action).toBe('create');
    expect(doc.revisions[0]?.userId).toBe('ana');
    expect(doc.revisions[0]?.at).toBe(FIXED_NOW);
  });

  it('insere texto no meio de um campo', () => {
    const doc = makeDoc();
    insertText(doc, 'note', 9, 'Sr. ', 'ana', makeDeps());
    expect(getField(doc, 'note').text).toBe('Contato: Sr. John Doe esteve no evento.');
  });

  it('insere texto no início e no fim de um campo', () => {
    const doc = makeDoc();
    insertText(doc, 'title', 0, '[Novo] ', 'ana', makeDeps());
    insertText(doc, 'title', getField(doc, 'title').text.length, '!', 'ana', makeDeps());
    expect(getField(doc, 'title').text).toBe('[Novo] Relatório semanal!');
  });

  it('rejeita offset de inserção fora dos limites', () => {
    const doc = makeDoc();
    expect(() => insertText(doc, 'note', -1, 'x')).toThrow(/offset de inserção inválido/);
    expect(() => insertText(doc, 'note', 10_000, 'x')).toThrow(/offset de inserção inválido/);
  });

  it('remove trecho por offsets absolutos', () => {
    const doc = makeDoc();
    removeText(doc, 'note', 0, 9, 'ana', makeDeps());
    expect(getField(doc, 'note').text).toBe('John Doe esteve no evento.');
  });

  it('rejeita remoção com intervalo inválido', () => {
    const doc = makeDoc();
    expect(() => removeText(doc, 'note', 5, 2)).toThrow(/intervalo inválido/);
    expect(() => removeText(doc, 'note', 0, 10_000)).toThrow(/intervalo inválido/);
  });

  it('lê trecho por offsets absolutos', () => {
    const doc = makeDoc();
    expect(readRange(doc, 'note', 9, 17)).toBe('John Doe');
  });

  it('redefine integralmente o texto de um campo', () => {
    const doc = makeDoc();
    setFieldText(doc, 'summary', 'novo resumo', 'bruno', makeDeps());
    expect(getField(doc, 'summary').text).toBe('novo resumo');
    expect(doc.revisions.at(-1)?.action).toBe('edit');
    expect(doc.revisions.at(-1)?.userId).toBe('bruno');
  });

  it('valida identificadores de campo em runtime', () => {
    expect(isDocumentFieldId('note')).toBe(true);
    expect(isDocumentFieldId('body')).toBe(false);
  });
});
