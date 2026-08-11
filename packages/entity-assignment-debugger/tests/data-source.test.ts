/**
 * Testes das três fontes de dados: CSV e JSON (ESTRUTURADAS) e texto livre com
 * extrator por padrões/regex (NÃO ESTRUTURADA) — importação de data items da
 * patente US 9,984,152 B2.
 */
import { describe, expect, it } from 'vitest';
import {
  CsvDataSource,
  dataSourceFromDescriptor,
  JsonDataSource,
  TextDataSource,
} from '../src/core/data-source.js';

describe('CsvDataSource (estruturada)', () => {
  it('importa linhas como data items com campos do cabeçalho', () => {
    const items = new CsvDataSource('nome,idade\nAda,36\nGrace,85\n').importData();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'row-1', fields: { nome: 'Ada', idade: '36' } });
    expect(items[1]).toEqual({ id: 'row-2', fields: { nome: 'Grace', idade: '85' } });
  });

  it('suporta delimitador customizado e ignora linhas vazias', () => {
    const items = new CsvDataSource('a;b\n\n1;2\n', ';').importData();
    expect(items).toEqual([{ id: 'row-1', fields: { a: '1', b: '2' } }]);
  });

  it('CSV vazio → nenhum data item', () => {
    expect(new CsvDataSource('').importData()).toEqual([]);
  });
});

describe('JsonDataSource (estruturada)', () => {
  it('importa array de objetos preservando tipos dos valores', () => {
    const items = new JsonDataSource('[{"nome": "Ada", "idade": 36}, {"nome": "Grace"}]').importData();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'item-1', fields: { nome: 'Ada', idade: 36 } });
    expect(items[1]!.fields['nome']).toBe('Grace');
  });

  it('aceita array já parseado e encapsula valores escalares', () => {
    const items = new JsonDataSource([1, 'x']).importData();
    expect(items[0]).toEqual({ id: 'item-1', fields: { value: 1 } });
  });

  it('rejeita JSON que não é array', () => {
    expect(() => new JsonDataSource('{"a": 1}').importData()).toThrow(/array/);
  });
});

describe('TextDataSource (não estruturada, extrator por padrões)', () => {
  const PATTERN = '^(?<nome>[A-Za-z ]+) tem (?<idade>\\d+) anos$';

  it('extrai data items de texto livre via regex com grupos nomeados', () => {
    const text = 'Ada Lovelace tem 36 anos\nlinha sem padrão\nGrace Hopper tem 85 anos\n';
    const items = new TextDataSource(text, PATTERN).importData();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'match-1', fields: { nome: 'Ada Lovelace', idade: '36' } });
    expect(items[1]).toEqual({ id: 'match-2', fields: { nome: 'Grace Hopper', idade: '85' } });
  });

  it('aceita RegExp diretamente', () => {
    const items = new TextDataSource('Ada tem 36 anos', /^(?<nome>\w+) tem (?<idade>\d+) anos$/).importData();
    expect(items[0]!.fields).toEqual({ nome: 'Ada', idade: '36' });
  });

  it('sem correspondências → nenhum data item', () => {
    expect(new TextDataSource('nada aqui', PATTERN).importData()).toEqual([]);
  });
});

describe('dataSourceFromDescriptor', () => {
  it('constrói cada tipo a partir do descritor serializável', () => {
    expect(dataSourceFromDescriptor({ type: 'csv', content: 'a\n1\n' }).kind).toBe('csv');
    expect(dataSourceFromDescriptor({ type: 'json', content: '[]' }).kind).toBe('json');
    expect(dataSourceFromDescriptor({ type: 'text', content: 'x', pattern: '(?<v>x)' }).kind).toBe('text');
  });

  it('exige pattern para o tipo text', () => {
    expect(() => dataSourceFromDescriptor({ type: 'text', content: 'x' })).toThrow(/pattern/);
  });
});
