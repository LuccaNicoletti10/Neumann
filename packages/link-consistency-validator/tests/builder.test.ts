/**
 * link-consistency-validator — testes do ScriptBuilder que executa a DSL
 * (componente "transformation script builder" da patente US 8,930,897 B2).
 */
import { describe, expect, it } from 'vitest';
import { BuilderError, ScriptBuilder } from '../src/core/builder.js';

const DSL = [
  'object Pessoa',
  'object Empresa',
  'property Pessoa.nome: string',
  'link Pessoa --trabalha_em--> Empresa',
  'link Empresa --emprega--> Pessoa',
  'condition c1 Pessoa --trabalha_em--> Empresa uses csv-1',
].join('\n');

describe('ScriptBuilder', () => {
  it('executa a DSL produzindo entidades definidas, links criados e condições', () => {
    const builder = ScriptBuilder.fromDsl(DSL);
    expect(builder.entities).toHaveLength(3);
    expect(builder.links).toHaveLength(2);
    expect(builder.conditions).toHaveLength(1);
    expect(builder.entity('Pessoa.nome')?.kind).toBe('property');
  });

  it('localiza link criado por casamento exato from/predicate/to', () => {
    const builder = ScriptBuilder.fromDsl(DSL);
    expect(
      builder.createdLink({ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }),
    ).toBeDefined();
    expect(
      builder.createdLink({ from: 'Empresa', predicate: 'trabalha_em', to: 'Pessoa' }),
    ).toBeUndefined();
  });

  it('rejeita entidade duplicada', () => {
    expect(() => ScriptBuilder.fromDsl('object Pessoa\nobject Pessoa')).toThrow(BuilderError);
  });

  it('rejeita propriedade definida antes do objeto pai', () => {
    expect(() => ScriptBuilder.fromDsl('property Pessoa.nome: string\nobject Pessoa')).toThrow(
      /objeto pai/,
    );
  });

  it('rejeita link que referencia entidade não definida', () => {
    expect(() => ScriptBuilder.fromDsl('object Pessoa\nlink Pessoa --x--> Empresa')).toThrow(
      /não definida/,
    );
  });
});
