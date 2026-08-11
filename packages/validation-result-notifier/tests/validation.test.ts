import { describe, expect, it } from 'vitest';
import {
  assignmentMatchesDefinition,
  createTransformationScript,
  importDataItems,
  runDebugOperation,
  validateCondition,
} from '../src/core/validation.js';
import type { Condition, TransformationScript } from '../src/core/types.js';

function baseScript(): TransformationScript {
  return createTransformationScript('t')
    .defineEntityAsObject('Cliente')
    .defineEntityAsProperty('nome', 'Cliente')
    .addOntologyParameter({
      name: 'p-nome',
      defines: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      acceptedTypes: ['record'],
    })
    .build();
}

describe('TransformationScriptBuilder', () => {
  it('define entidade como OBJETO e como PROPRIEDADE de objeto', () => {
    const script = baseScript();
    expect(script.entities).toEqual([
      { entity: 'Cliente', kind: 'object' },
      { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
    ]);
  });

  it('associa parâmetros ontológicos que também atribuem entidade', () => {
    const script = baseScript();
    expect(script.ontologyParameters).toHaveLength(1);
    expect(script.ontologyParameters[0]?.defines.kind).toBe('property');
  });

  it('build retorna cópia imutável das listas', () => {
    const builder = createTransformationScript('x').defineEntityAsObject('A');
    const first = builder.build();
    builder.defineEntityAsObject('B');
    expect(first.entities).toHaveLength(1);
  });
});

describe('importDataItems', () => {
  it('importa fonte ESTRUTURADA CSV com campos do cabeçalho', () => {
    const items = importDataItems({ format: 'csv', content: 'id,nome\na1,Ada\na2,Grace' });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'a1', type: 'record', fields: { id: 'a1', nome: 'Ada' } });
  });

  it('importa fonte ESTRUTURADA JSON (array de objetos)', () => {
    const items = importDataItems({
      format: 'json',
      content: JSON.stringify([{ id: 'j1', type: 'pessoa', nome: 'Alan' }]),
    });
    expect(items[0]).toMatchObject({ id: 'j1', type: 'pessoa' });
    expect(items[0]?.fields?.['nome']).toBe('Alan');
  });

  it('importa fonte NÃO ESTRUTURADA texto (uma linha por item)', () => {
    const items = importDataItems({ format: 'text', content: 'linha um\n\nlinha dois' });
    expect(items).toEqual([
      { id: 'line-0', type: 'text', value: 'linha um' },
      { id: 'line-1', type: 'text', value: 'linha dois' },
    ]);
  });

  it('rejeita JSON que não é array', () => {
    expect(() => importDataItems({ format: 'json', content: '{"a":1}' })).toThrow(/array/);
  });
});

describe('validateCondition — determinação valid/invalid', () => {
  const items = importDataItems({ format: 'csv', content: 'id,nome\na1,Ada' });

  it('VÁLIDA: atribuição consistente com a definição + mapping compatível', () => {
    const condition: Condition = {
      id: 'c-ok',
      description: 'ok',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'a1', parameterName: 'p-nome' }],
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.valid).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('INVÁLIDA: atribuição da entidade inconsistente com a definição (objeto vs propriedade)', () => {
    const condition: Condition = {
      id: 'c-bad',
      description: 'bad',
      assignment: { entity: 'nome', kind: 'object' },
      mappings: [],
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons[0]?.code).toBe('entity-inconsistent');
  });

  it('INVÁLIDA: propriedade atribuída a objeto pai diferente do definido', () => {
    const condition: Condition = {
      id: 'c-pai',
      description: 'bad',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Fornecedor' },
      mappings: [],
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.reasons[0]?.code).toBe('entity-inconsistent');
  });

  it('INVÁLIDA: entidade sem definição no script nem em parâmetro', () => {
    const condition: Condition = {
      id: 'c-sem-def',
      description: 'bad',
      assignment: { entity: 'Inexistente', kind: 'object' },
      mappings: [],
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.reasons[0]?.code).toBe('entity-inconsistent');
  });

  it('INVÁLIDA: mapping incompatível (tipo do data item não aceito pelo parâmetro)', () => {
    const textItems = importDataItems({ format: 'text', content: 'texto livre' });
    const condition: Condition = {
      id: 'c-map',
      description: 'bad',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'line-0', parameterName: 'p-nome' }],
    };
    const verdict = validateCondition(condition, baseScript(), textItems);
    expect(verdict.reasons.map((r) => r.code)).toContain('mapping-incompatible');
  });

  it('INVÁLIDA: data item do mapping não importado da fonte', () => {
    const condition: Condition = {
      id: 'c-miss',
      description: 'bad',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'zzz', parameterName: 'p-nome' }],
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.reasons.map((r) => r.code)).toEqual(['data-item-missing']);
  });

  it('INVÁLIDA: parâmetro ontológico do mapping não associado ao script', () => {
    const condition: Condition = {
      id: 'c-param',
      description: 'bad',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'a1', parameterName: 'p-inexistente' }],
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.reasons.map((r) => r.code)).toEqual(['mapping-incompatible']);
  });

  it('INVÁLIDA: requisito de campo do data source não atendido', () => {
    const condition: Condition = {
      id: 'c-req',
      description: 'bad',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'a1', parameterName: 'p-nome' }],
      sourceRequirement: { field: 'cpf' },
    };
    const verdict = validateCondition(condition, baseScript(), items);
    expect(verdict.reasons.map((r) => r.code)).toContain('source-requirement-unmet');
  });

  it('parâmetro ontológico tem precedência sobre definição do script', () => {
    const script = createTransformationScript('t')
      .defineEntityAsObject('Coisa')
      .addOntologyParameter({ name: 'p', defines: { entity: 'Coisa', kind: 'property', parentObject: 'Dono' } })
      .build();
    const condition: Condition = {
      id: 'c-prec',
      description: '',
      assignment: { entity: 'Coisa', kind: 'object' },
      mappings: [],
    };
    const verdict = validateCondition(condition, script, []);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons[0]?.code).toBe('entity-inconsistent');
  });
});

describe('assignmentMatchesDefinition', () => {
  it('compara natureza e objeto pai', () => {
    expect(
      assignmentMatchesDefinition(
        { entity: 'e', kind: 'property', parentObject: 'P' },
        { entity: 'e', kind: 'property', parentObject: 'P' },
      ),
    ).toBe(true);
    expect(
      assignmentMatchesDefinition({ entity: 'e', kind: 'object' }, { entity: 'e', kind: 'property', parentObject: 'P' }),
    ).toBe(false);
  });
});

describe('runDebugOperation', () => {
  it('valida todas as condições em ordem', () => {
    const script = createTransformationScript('t')
      .defineEntityAsObject('A')
      .addCondition({ id: 'c1', description: '', assignment: { entity: 'A', kind: 'object' }, mappings: [] })
      .addCondition({ id: 'c2', description: '', assignment: { entity: 'A', kind: 'property', parentObject: 'X' }, mappings: [] })
      .build();
    const verdicts = runDebugOperation(script, []);
    expect(verdicts.map((v) => [v.conditionId, v.valid])).toEqual([
      ['c1', true],
      ['c2', false],
    ]);
  });
});
