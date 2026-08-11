/**
 * tagging-interface-panel — tests/parser.test.ts
 * Testes da compilação de parser definitions e do parse de entradas.
 */
import { describe, expect, it } from 'vitest';

import {
  compileParserDefinition,
  parseInput,
  parseWithDefinitions,
} from '../src/core/parser.js';
import { nameOntology } from './helpers.js';

function defs() {
  return nameOntology().parserDefinitions;
}

function lastFirst() {
  const def = defs().find((d) => d.name === 'name-last-first');
  if (def === undefined) throw new Error('def ausente');
  return def;
}

function firstLast() {
  const def = defs().find((d) => d.name === 'name-first-last');
  if (def === undefined) throw new Error('def ausente');
  return def;
}

describe('compileParserDefinition + parseInput', () => {
  it('"Smith, Jane" é VÁLIDO em "{LAST NAME}, {FIRST NAME}"', () => {
    const result = parseInput(compileParserDefinition(lastFirst()), 'Smith, Jane');
    expect(result.valid).toBe(true);
    expect(result.components).toEqual({ 'LAST NAME': 'Smith', 'FIRST NAME': 'Jane' });
  });

  it('componentes são mapeados para os property types (Name:Last, Name:First)', () => {
    const result = parseInput(compileParserDefinition(lastFirst()), 'Smith, Jane');
    expect(result.mapped).toEqual({ 'Name:Last': 'Smith', 'Name:First': 'Jane' });
  });

  it('"Smith Jane" é INVÁLIDO em "{LAST NAME}, {FIRST NAME}"', () => {
    const result = parseInput(compileParserDefinition(lastFirst()), 'Smith Jane');
    expect(result.valid).toBe(false);
    expect(result.mapped).toBeUndefined();
  });

  it('"Smith Jane" é VÁLIDO em "{FIRST NAME} {LAST NAME}" (outra definição aceita)', () => {
    const result = parseInput(compileParserDefinition(firstLast()), 'Smith Jane');
    expect(result.valid).toBe(true);
    expect(result.mapped).toEqual({ 'Name:First': 'Smith', 'Name:Last': 'Jane' });
  });

  it('a regex é ancorada: toda a entrada precisa casar com o padrão', () => {
    const def = {
      name: 'par',
      pattern: '{FIRST NAME} {LAST NAME}!',
      components: [
        { token: 'FIRST NAME', propertyType: 'Name:First' },
        { token: 'LAST NAME', propertyType: 'Name:Last' },
      ],
    };
    const parser = compileParserDefinition(def);
    // Sem o literal final "!", a entrada não casa (ancoragem ^...$).
    expect(parseInput(parser, 'Smith Jane').valid).toBe(false);
    expect(parseInput(parser, 'Smith Jane!').valid).toBe(true);
  });

  it('literais com caracteres especiais de regex são escapados', () => {
    const def = {
      name: 'doc',
      pattern: '{PARTE A}. {PARTE B}',
      components: [
        { token: 'PARTE A', propertyType: 'Doc:A' },
        { token: 'PARTE B', propertyType: 'Doc:B' },
      ],
    };
    const parser = compileParserDefinition(def);
    expect(parseInput(parser, 'abc. def').valid).toBe(true);
    expect(parseInput(parser, 'abcx def').valid).toBe(false);
  });

  it('token sem componente associado lança erro na compilação', () => {
    const def = {
      name: 'quebrado',
      pattern: '{A} {B}',
      components: [{ token: 'A', propertyType: 'X' }],
    };
    expect(() => compileParserDefinition(def)).toThrow(/token sem componente/);
  });
});

describe('parseWithDefinitions', () => {
  it('"Smith, Jane" é válido em name-last-first (a definição correta vem primeiro)', () => {
    const matches = parseWithDefinitions(defs(), 'Smith, Jane');
    // "Smith, Jane" também satisfaz "{FIRST} {LAST}" (FIRST='Smith,', LAST='Jane'):
    // a validade é sempre relativa à parser definition escolhida.
    expect(matches).toHaveLength(2);
    expect(matches[0]?.definitionName).toBe('name-last-first');
    expect(matches[0]?.mapped).toEqual({ 'Name:Last': 'Smith', 'Name:First': 'Jane' });
  });

  it('"Smith Jane" casa apenas com name-first-last', () => {
    const matches = parseWithDefinitions(defs(), 'Smith Jane');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.definitionName).toBe('name-first-last');
  });

  it('entrada sem nenhum casamento retorna lista vazia', () => {
    expect(parseWithDefinitions(defs(), 'SemFormato')).toHaveLength(0);
  });
});
