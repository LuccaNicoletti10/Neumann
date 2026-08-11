/**
 * cli-script-debugger — tests/validator.test.ts
 * Testa o núcleo de validação: vereditos válido/inválido, atribuição
 * inconsistente, mapping incompatível, condições inválidas e importação de
 * fontes CSV (estruturada) e texto (não estruturada).
 */
import { describe, expect, it } from 'vitest';

import { createScriptBuilder } from '../src/core/builder.js';
import { isAssignmentConsistent, parseOntology } from '../src/core/ontology.js';
import { importCsv, importText, Validator } from '../src/core/validator.js';
import { sampleCsv, sampleOntology, sampleScript, sampleText } from './helpers.js';

describe('importação de data items', () => {
  it('importa CSV estruturado com cabeçalho', () => {
    const items = importCsv(sampleCsv());
    expect(items).toHaveLength(2);
    expect(items[0]?.source).toBe('csv');
    expect(items[0]?.fields).toEqual({ id: '1', nome: 'Ada', idade: '36' });
    expect(items[1]?.line).toBe(3);
  });

  it('ignora linhas vazias e faz trim', () => {
    const items = importCsv('a,b\n\n 1 , 2 \n');
    expect(items).toHaveLength(1);
    expect(items[0]?.fields['a']).toBe('1');
  });

  it('importa texto não estruturado (um item por linha)', () => {
    const items = importText(sampleText());
    expect(items).toHaveLength(2);
    expect(items[0]?.source).toBe('text');
    expect(items[0]?.fields).toEqual({ text: 'registro um' });
    expect(items[1]?.line).toBe(2);
  });

  it('CSV vazio não produz itens', () => {
    expect(importCsv('')).toEqual([]);
    expect(importCsv('a,b,c\n')).toEqual([]);
  });
});

describe('validação — cenário válido', () => {
  it('veredito válido quando atribuições, mappings e condições são consistentes', () => {
    const verdict = new Validator(sampleScript(), {
      mode: 'eager',
      ontology: sampleOntology(),
    }).run(importCsv(sampleCsv()));
    expect(verdict.valid).toBe(true);
    expect(verdict.issues).toEqual([]);
    expect(verdict.stats.items).toBe(2);
    expect(verdict.stats.evaluated).toBe(4); // 2 condições × 2 itens
    expect(verdict.stats.failed).toBe(0);
  });
});

describe('validação — atribuição inconsistente com a definição', () => {
  it('objeto no script × propriedade na ontologia', () => {
    const ontology = sampleOntology();
    ontology.parameters[0] = {
      name: 'personId',
      entity: 'pessoa',
      assignment: { kind: 'property', objectType: 'Person', property: 'id' },
    };
    const verdict = new Validator(sampleScript(), { mode: 'eager', ontology }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.valid).toBe(false);
    expect(
      verdict.issues.some(
        (i) => i.code === 'INCONSISTENT_ASSIGNMENT' && i.parameter === 'personId',
      ),
    ).toBe(true);
  });

  it('propriedade divergente (nome diferente) é inconsistente', () => {
    const ontology = sampleOntology();
    ontology.parameters[1] = {
      name: 'personName',
      entity: 'pessoaNome',
      assignment: { kind: 'property', objectType: 'Person', property: 'fullName' },
    };
    const verdict = new Validator(sampleScript(), { mode: 'eager', ontology }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.issues.some((i) => i.code === 'INCONSISTENT_ASSIGNMENT')).toBe(true);
  });

  it('parâmetro referenciando entidade ausente no script', () => {
    const ontology = sampleOntology();
    ontology.parameters.push({
      name: 'alien',
      entity: 'inexistente',
      assignment: { kind: 'object', objectType: 'Person' },
    });
    const verdict = new Validator(sampleScript(), { mode: 'eager', ontology }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.issues.some((i) => i.code === 'UNKNOWN_ENTITY')).toBe(true);
  });
});

describe('validação — mapping incompatível', () => {
  it('mapping para ontology parameter inexistente', () => {
    const script = createScriptBuilder('m')
      .defineObject('pessoa', 'Person')
      .addMapping({ entity: 'pessoa', dataField: 'id', parameter: 'naoExiste' })
      .build();
    const verdict = new Validator(script, { mode: 'eager', ontology: sampleOntology() }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.issues.some((i) => i.code === 'INVALID_MAPPING')).toBe(true);
  });

  it('mapping com entidade divergente da do parâmetro', () => {
    const script = createScriptBuilder('m')
      .defineObject('pessoa', 'Person')
      .defineObject('empresa', 'Company')
      .addMapping({ entity: 'empresa', dataField: 'id', parameter: 'personId' })
      .build();
    const verdict = new Validator(script, { mode: 'eager', ontology: sampleOntology() }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.issues.some((i) => i.code === 'INVALID_MAPPING')).toBe(true);
  });

  it('mapping de campo inexistente nos data items', () => {
    const script = createScriptBuilder('m')
      .defineObject('pessoa', 'Person')
      .addMapping({ entity: 'pessoa', dataField: 'colunaFantasma', parameter: 'personId' })
      .build();
    const verdict = new Validator(script, { mode: 'eager', ontology: sampleOntology() }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.issues.some((i) => i.code === 'INVALID_MAPPING')).toBe(true);
  });
});

describe('validação — condição inválida com base nos ontology parameters', () => {
  it('condição sobre data source não mapeado a parâmetro é inválida', () => {
    const script = createScriptBuilder('c')
      .defineObject('pessoa', 'Person')
      .addMapping({ entity: 'pessoa', dataField: 'id', parameter: 'personId' })
      .addCondition({ dataSource: 'nome', type: 'contains', expected: 'a' })
      .build();
    const verdict = new Validator(script, { mode: 'eager', ontology: sampleOntology() }).run(
      importCsv(sampleCsv()),
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.issues.some((i) => i.code === 'INVALID_CONDITION')).toBe(true);
  });

  it('faixa numérica sobre valor não numérico é condição inválida', () => {
    const script = createScriptBuilder('c')
      .defineObject('pessoa', 'Person')
      .addMapping({ entity: 'pessoa', dataField: 'idade', parameter: 'personAge' })
      .addCondition({ dataSource: 'idade', type: 'numericRange', min: 0, max: 150 })
      .build();
    const verdict = new Validator(script, { mode: 'eager', ontology: sampleOntology() }).run(
      importCsv('idade\nabc\n'),
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.issues.some((i) => i.code === 'INVALID_CONDITION')).toBe(true);
    expect(verdict.stats.failed).toBe(1);
  });

  it('condição válida em fonte de texto não estruturada', () => {
    const script = createScriptBuilder('t')
      .defineObject('pessoa', 'Person')
      .addMapping({ entity: 'pessoa', dataField: 'text', parameter: 'personId' })
      .addCondition({ dataSource: 'text', type: 'contains', expected: 'registro' })
      .build();
    const verdict = new Validator(script, {
      mode: 'eager',
      ontology: {
        name: 'texto-ontology',
        parameters: [
          { name: 'personId', entity: 'pessoa', assignment: { kind: 'object', objectType: 'Person' } },
        ],
      },
    }).run(importText(sampleText()));
    expect(verdict.valid).toBe(true);
    expect(verdict.stats.evaluated).toBe(2);
  });
});

describe('ontologia — parsing e consistência', () => {
  it('parseOntology valida estrutura', () => {
    expect(() => parseOntology('{"name":"x"}')).toThrow(/parameters/);
    expect(() => parseOntology('{"parameters":[]}')).toThrow(/name/);
  });

  it('isAssignmentConsistent compara kind, objectType e propriedade', () => {
    expect(
      isAssignmentConsistent(
        { kind: 'object', objectType: 'Person' },
        { kind: 'object', objectType: 'Person' },
      ),
    ).toBe(true);
    expect(
      isAssignmentConsistent(
        { kind: 'object', objectType: 'Person' },
        { kind: 'property', objectType: 'Person', property: 'id' },
      ),
    ).toBe(false);
    expect(
      isAssignmentConsistent(
        { kind: 'property', objectType: 'Person', property: 'name' },
        { kind: 'property', objectType: 'Person', property: 'name' },
      ),
    ).toBe(true);
    expect(
      isAssignmentConsistent(
        { kind: 'property', objectType: 'Person', property: 'name' },
        { kind: 'property', objectType: 'Person', property: 'other' },
      ),
    ).toBe(false);
  });
});
