/**
 * link-consistency-validator — testes da operação de depuração (consistência de
 * link e de atribuição de entidade; fluxo expressed/implicit) da patente
 * US 8,930,897 B2.
 */
import { describe, expect, it } from 'vitest';
import { ScriptBuilder } from '../src/core/builder.js';
import { Ontology } from '../src/core/ontology.js';
import { CollectingDisplayDevice } from '../src/core/types.js';
import {
  findInconsistencies,
  ScriptValidator,
  VALIDATED_MESSAGE,
  ValidatorError,
} from '../src/core/validator.js';
import type { DataItem } from '../src/core/types.js';

const ITEMS: DataItem[] = [
  { id: 'csv-1', source: 'csv', fields: { nome: 'Ana' } },
  { id: 'csv-2', source: 'csv', fields: { nome: 'Bruno' } },
];

function makeBuilder(script: string): ScriptBuilder {
  return ScriptBuilder.fromDsl(script);
}

function setup(script: string, ontologyJson: unknown) {
  const builder = makeBuilder(script);
  const ontology = Ontology.fromJson(ontologyJson as Parameters<typeof Ontology.fromJson>[0]);
  const display = new CollectingDisplayDevice();
  const validator = new ScriptValidator(ontology, display);
  return { builder, validator, display };
}

const BASE_SCRIPT = [
  'object Pessoa',
  'object Empresa',
  'link Pessoa --trabalha_em--> Empresa',
  'condition c1 Pessoa --trabalha_em--> Empresa uses csv-1',
].join('\n');

describe('consistência de link', () => {
  it('válida quando o link atribuído na ontologia casa com o criado no builder', () => {
    const { builder, validator } = setup(BASE_SCRIPT, {
      links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'expressed', valid: true, message: VALIDATED_MESSAGE });
  });

  it('inválida quando a ontologia atribui o link com direção invertida', () => {
    const { builder, validator, display } = setup(BASE_SCRIPT, {
      links: [{ from: 'Empresa', predicate: 'trabalha_em', to: 'Pessoa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'expressed', valid: false });
    expect(results[0]?.message).toContain('não é válida');
    expect(results[0]?.message).toMatch(/direção invertida ou predicado divergente/);
    expect(display.messages).toEqual([results[0]?.message]);
  });

  it('inválida quando a ontologia atribui predicado divergente entre as mesmas entidades', () => {
    const { builder, validator } = setup(BASE_SCRIPT, {
      links: [{ from: 'Pessoa', predicate: 'contratada_por', to: 'Empresa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results[0]?.valid).toBe(false);
    expect(results[0]?.message).toMatch(/predicado divergente|direção invertida/);
  });

  it('inválida quando a ontologia não atribui link entre as entidades', () => {
    const { builder, validator } = setup(BASE_SCRIPT, {
      links: [{ from: 'Outra', predicate: 'x', to: 'Coisa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results[0]?.valid).toBe(false);
    expect(results[0]?.message).toContain('ontologia não atribui link');
  });

  it('inválida quando o builder não criou o link da condição', () => {
    const script = [
      'object Pessoa',
      'object Empresa',
      'link Pessoa --trabalha_em--> Empresa',
      'condition c1 Pessoa --emprega--> Empresa uses csv-1',
    ].join('\n');
    const { builder, validator } = setup(script, {
      links: [{ from: 'Pessoa', predicate: 'emprega', to: 'Empresa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results[0]?.valid).toBe(false);
    expect(results[0]?.message).toContain('não foi criado no builder');
  });
});

describe('consistência de atribuição de entidade', () => {
  it('inválida quando a ontologia atribui a entidade como propriedade e o builder a define como objeto', () => {
    const { builder, validator } = setup(BASE_SCRIPT, {
      entities: [{ kind: 'property', name: 'Pessoa', parent: 'Registro' }],
      links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results[0]?.valid).toBe(false);
    expect(results[0]?.message).toMatch(/atribuição da entidade "Pessoa".*inconsistente/);
  });

  it('válida quando as atribuições de entidade são consistentes', () => {
    const { builder, validator } = setup(BASE_SCRIPT, {
      entities: [
        { kind: 'object', name: 'Pessoa' },
        { kind: 'object', name: 'Empresa' },
      ],
      links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results[0]?.valid).toBe(true);
  });
});

describe('fluxo expressed/implicit', () => {
  const TWO_CONDITIONS = [
    'object Pessoa',
    'object Empresa',
    'link Pessoa --trabalha_em--> Empresa',
    'link Empresa --emprega--> Pessoa',
    'condition c1 Pessoa --trabalha_em--> Empresa uses csv-1',
    'condition c2 Empresa --emprega--> Pessoa uses csv-2',
  ].join('\n');
  const ONTOLOGY = {
    links: [
      { from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' },
      { from: 'Empresa', predicate: 'emprega', to: 'Pessoa' },
    ],
  };

  it('condição válida com subsequentes → implicit; última válida → expressed "validated"', () => {
    const { builder, validator, display } = setup(TWO_CONDITIONS, ONTOLOGY);
    const results = validator.debug(builder, ITEMS);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ kind: 'implicit', valid: true, conditionName: 'c1' });
    expect(results[1]).toMatchObject({
      kind: 'expressed',
      valid: true,
      conditionName: 'c2',
      message: 'transformation script has been validated',
    });
    // IMPLICIT é silencioso: só o EXPRESSED final vai ao display device.
    expect(display.messages).toEqual(['transformation script has been validated']);
  });

  it('condição inválida → expressed e a depuração para (condições subsequentes não rodam)', () => {
    // Ontologia atribui o link da PRIMEIRA condição com direção invertida.
    const { builder, validator, display } = setup(TWO_CONDITIONS, {
      links: [
        { from: 'Empresa', predicate: 'trabalha_em', to: 'Pessoa' },
        { from: 'Empresa', predicate: 'emprega', to: 'Pessoa' },
      ],
    });
    const results = validator.debug(builder, ITEMS);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'expressed', valid: false, conditionName: 'c1' });
    expect(display.messages).toHaveLength(1);
    expect(display.messages[0]).toContain('não é válida');
  });

  it('inválida quando o data item da condição não foi importado', () => {
    const { builder, validator } = setup(BASE_SCRIPT, {
      links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
    });
    const results = validator.debug(builder, []);
    expect(results[0]?.valid).toBe(false);
    expect(results[0]?.message).toContain('não foi importado');
  });

  it('exige pelo menos uma condição no script', () => {
    const { builder, validator } = setup('object Pessoa', {});
    expect(() => validator.debug(builder, ITEMS)).toThrow(ValidatorError);
  });

  it('findInconsistencies retorna lista vazia para condição consistente', () => {
    const { builder } = setup(BASE_SCRIPT, {});
    const ontology = Ontology.fromJson({
      links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
    });
    const condition = builder.conditions[0];
    expect(condition).toBeDefined();
    if (condition) {
      expect(findInconsistencies(builder, ontology, condition, ITEMS)).toEqual([]);
    }
  });
});
