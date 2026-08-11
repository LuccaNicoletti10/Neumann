/**
 * link-consistency-validator — testes da fonte de dados e importação de data
 * items (componente "data source with data items" da patente US 8,930,897 B2).
 */
import { describe, expect, it } from 'vitest';
import { DataSourceError, importDataItems } from '../src/core/data-source.js';

describe('fonte CSV estruturada', () => {
  it('importa linhas como data items com campos do cabeçalho', () => {
    const items = importDataItems({ type: 'csv', content: 'nome,empresa\nAna,ACME\nBruno,XYZ\n' });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'csv-1', source: 'csv', fields: { nome: 'Ana', empresa: 'ACME' } });
    expect(items[1]?.id).toBe('csv-2');
  });

  it('usa idColumn quando configurada', () => {
    const items = importDataItems({
      type: 'csv',
      content: 'id,nome\np-1,Ana\np-2,Bruno',
      idColumn: 'id',
    });
    expect(items.map((i) => i.id)).toEqual(['p-1', 'p-2']);
  });

  it('respeita campos entre aspas e delimitador configurável', () => {
    const items = importDataItems({
      type: 'csv',
      content: 'nome;obs\n"Ana; Silva";"disse ""oi"""\n',
      delimiter: ';',
    });
    expect(items[0]?.fields).toEqual({ nome: 'Ana; Silva', obs: 'disse "oi"' });
  });

  it('retorna lista vazia para conteúdo vazio', () => {
    expect(importDataItems({ type: 'csv', content: '' })).toEqual([]);
  });
});

describe('fonte de texto não estruturado (regex configurável)', () => {
  it('extrai data items por regex com grupos nomeados', () => {
    const items = importDataItems({
      type: 'text',
      content: 'PESSOA Ana TRABALHA_EM ACME\nPESSOA Bruno TRABALHA_EM XYZ',
      pattern: 'PESSOA (?<nome>\\w+) TRABALHA_EM (?<empresa>\\w+)',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'text-1',
      source: 'text',
      fields: { nome: 'Ana', empresa: 'ACME' },
      text: 'PESSOA Ana TRABALHA_EM ACME',
    });
  });

  it('extrai campos por grupos numerados com nomes configurados', () => {
    const items = importDataItems({
      type: 'text',
      content: 'Ana -> ACME',
      pattern: '(\\w+) -> (\\w+)',
      fields: ['nome', 'empresa'],
    });
    expect(items[0]?.fields).toEqual({ nome: 'Ana', empresa: 'ACME' });
  });

  it('rejeita regex inválido', () => {
    expect(() => importDataItems({ type: 'text', content: 'x', pattern: '(' })).toThrow(
      DataSourceError,
    );
  });
});
