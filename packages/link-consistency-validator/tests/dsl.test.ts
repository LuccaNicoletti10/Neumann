/**
 * link-consistency-validator — testes do parser da DSL do builder
 * (componente "builder DSL" da patente US 8,930,897 B2).
 */
import { describe, expect, it } from 'vitest';
import { DslSyntaxError, parseDsl } from '../src/core/dsl.js';

describe('parseDsl', () => {
  it('faz parse de object, property, link e condition', () => {
    const script = parseDsl(
      [
        '# comentário',
        'object Pessoa',
        'object Empresa',
        'property Pessoa.nome: string',
        'link Pessoa --trabalha_em--> Empresa',
        'condition c1 Pessoa --trabalha_em--> Empresa uses csv-1',
      ].join('\n'),
    );
    expect(script.entities).toEqual([
      { kind: 'object', name: 'Pessoa' },
      { kind: 'object', name: 'Empresa' },
      { kind: 'property', parent: 'Pessoa', name: 'nome', dataType: 'string' },
    ]);
    expect(script.links).toEqual([{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }]);
    expect(script.conditions).toEqual([
      {
        name: 'c1',
        link: { from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' },
        dataItemId: 'csv-1',
        line: 6,
      },
    ]);
  });

  it('ignora linhas vazias e comentários ao final da linha', () => {
    const script = parseDsl('\nobject Pessoa # entidade pessoa\n\n');
    expect(script.entities).toHaveLength(1);
  });

  it('aceita nomes qualificados nos endpoints do link', () => {
    const script = parseDsl('link Pessoa.nome --rotulo_de--> Empresa');
    expect(script.links[0]?.from).toBe('Pessoa.nome');
  });

  it('reporta erro de sintaxe com o número da linha', () => {
    let caught: unknown;
    try {
      parseDsl('object Pessoa\nlink Pessoa -> Empresa\n');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DslSyntaxError);
    expect((caught as DslSyntaxError).line).toBe(2);
    expect((caught as DslSyntaxError).message).toContain('linha 2');
  });

  it('rejeita property sem tipo', () => {
    expect(() => parseDsl('property Pessoa.nome')).toThrow(DslSyntaxError);
  });
});
