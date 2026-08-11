/**
 * external-content-exporter — tests/internalDb.test.ts
 * Testes do mecanismo 7 (INTERNAL DATABASE SYSTEM: data sources + ontologia).
 */
import { describe, expect, it } from 'vitest';

import { toParameterValuePairs } from '../src/core/exporter.js';
import { createInternalDb } from '../src/core/internalDb.js';
import { CoreError } from '../src/core/types.js';
import { makeStack, makeTag, sampleSession } from './helpers.js';

describe('internal database system', () => {
  it('armazena conteúdo em data sources com ids determinísticos', () => {
    const stack = makeStack();
    const { content } = sampleSession(stack);
    const primeiro = stack.internalDb.storeContent(content);
    const segundo = stack.internalDb.storeContent(content);
    expect(primeiro.id).toBe('datasource-1');
    expect(segundo.id).toBe('datasource-2');
    expect(stack.internalDb.listDataSources()).toHaveLength(2);
    expect(stack.internalDb.getDataSource(primeiro.id)?.label).toBe(content.label);
  });

  it('armazena pares no database segundo a ontology/object model', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const record = stack.internalDb.storePairs(toParameterValuePairs(tag));
    expect(record.id).toBe('record-1');
    expect(record.ontologyClass).toBe('object');
    expect(record.objectType).toBe('Person');
    expect(record.contentLabel).toBe(tag.contentLabel);
    expect(record.pairs).toHaveLength(6);
  });

  it('mapeia TagOption property e link para as classes da ontologia', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const propertyTag = session.createTag(
      { tagOption: 'property', title: 'Nome', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 2 },
    );
    const linkTag = session.createTag(
      { tagOption: 'link', title: 'Vínculo', type: 'CaseLink' },
      { kind: 'text', startOffset: 3, endOffset: 5 },
    );
    expect(stack.internalDb.storePairs(toParameterValuePairs(propertyTag)).ontologyClass).toBe('property');
    expect(stack.internalDb.storePairs(toParameterValuePairs(linkTag)).ontologyClass).toBe('link');
  });

  it('consulta registros por label do conteúdo', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    makeTag(stack, session, 'A');
    makeTag(stack, session, 'B');
    const login = stack.auth.login('analyst', 'senha-demo');
    stack.exporter.flushPending(login.token);
    const label = stack.internalDb.listRecords()[0]?.contentLabel ?? '';
    const found = stack.internalDb.queryByLabel(label);
    expect(found).toHaveLength(2);
    expect(stack.internalDb.queryByLabel('label-inexistente')).toHaveLength(0);
  });

  it('rejeita pares sem Content ou com TagOption fora da ontologia', () => {
    const stack = makeStack();
    expect(() =>
      stack.internalDb.storePairs([
        { parameter: 'TagOption', value: 'object' },
        { parameter: 'Type', value: 'Person' },
      ]),
    ).toThrow(CoreError);
    expect(() =>
      stack.internalDb.storePairs([
        { parameter: 'TagOption', value: 'estranho' },
        { parameter: 'Type', value: 'X' },
        { parameter: 'Content', value: 'c' },
      ]),
    ).toThrow(/TagOption fora da ontology\/object model/);
  });

  it('devolve cópias defensivas de registros e data sources', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = makeTag(stack, session);
    const record = stack.internalDb.storePairs(toParameterValuePairs(tag));
    const [copia] = stack.internalDb.queryByLabel(tag.contentLabel);
    copia?.pairs.splice(0, copia.pairs.length);
    expect(stack.internalDb.getRecord(record.id)?.pairs).toHaveLength(6);
  });

  it('getRecord/getDataSource devolvem undefined para ids desconhecidos', () => {
    const stack = makeStack();
    expect(stack.internalDb.getRecord('record-99')).toBeUndefined();
    expect(stack.internalDb.getDataSource('datasource-99')).toBeUndefined();
  });
});
