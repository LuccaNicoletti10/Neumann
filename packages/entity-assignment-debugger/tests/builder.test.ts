/**
 * Testes do builder fluente (componente da patente US 9,984,152 B2 que DEFINE
 * entidades como objeto/propriedade e CRIA links entre entidades).
 */
import { describe, expect, it } from 'vitest';
import { TransformationBuilder } from '../src/core/builder.js';

describe('TransformationBuilder (API fluente)', () => {
  it('define objetos, propriedades, links, mappings e condições de forma fluente', () => {
    const script = new TransformationBuilder('meu-script')
      .defineObject('Pessoa', { nome: 'string', idade: 'number' })
      .defineObject('Cidade', { nome: 'string' })
      .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
      .createLink('resideEm', 'Pessoa', 'Cidade')
      .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
      .addCondition({ id: 'c1', entity: 'Endereco', links: ['resideEm'], dataItemId: 'row-1' })
      .build();

    expect(script.name).toBe('meu-script');
    expect(script.definitions).toHaveLength(3);

    const pessoa = script.definitions.find((d) => d.name === 'Pessoa');
    expect(pessoa).toMatchObject({ kind: 'object', properties: { nome: 'string', idade: 'number' } });

    const endereco = script.definitions.find((d) => d.name === 'Endereco');
    expect(endereco).toMatchObject({ kind: 'property', owner: 'Pessoa', valueType: 'string' });

    expect(script.links).toEqual([{ name: 'resideEm', from: 'Pessoa', to: 'Cidade' }]);
    expect(script.mappings).toEqual([
      { dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' },
    ]);
    expect(script.conditions).toEqual([
      { id: 'c1', entity: 'Endereco', links: ['resideEm'], dataItemId: 'row-1' },
    ]);
  });

  it('redefinir uma entidade substitui a definição anterior', () => {
    const script = new TransformationBuilder('s')
      .defineObject('X', { a: 'string' })
      .defineProperty('X', { owner: 'Y', valueType: 'number' })
      .build();
    expect(script.definitions).toHaveLength(1);
    expect(script.definitions[0]).toMatchObject({ kind: 'property', owner: 'Y' });
  });

  it('build() retorna cópias defensivas (mutar o resultado não afeta o builder)', () => {
    const builder = new TransformationBuilder('s').defineObject('Pessoa', { nome: 'string' });
    const first = builder.build();
    first.definitions[0]!.properties!['nome'] = 'number';
    const second = builder.build();
    expect(second.definitions[0]!.properties!['nome']).toBe('string');
  });

  it('o script construído é serializável em JSON (round-trip)', () => {
    const script = new TransformationBuilder('s')
      .defineObject('Pessoa', { nome: 'string' })
      .createLink('l1', 'Pessoa', 'Pessoa')
      .addCondition({ id: 'c1', entity: 'Pessoa' })
      .build();
    const roundTripped = JSON.parse(JSON.stringify(script));
    expect(roundTripped.name).toBe('s');
    expect(roundTripped.definitions).toHaveLength(1);
    expect(roundTripped.links).toHaveLength(1);
  });
});
