/**
 * Testes do fluxo EXATO de indicação da operação de depuração
 * (patente US 9,984,152 B2):
 *   (a) condição inválida → EXPRESSED no display device (falha);
 *   (b) condição válida + existe subsequente → IMPLICIT (silencioso);
 *   (c) condição válida + sem subsequentes → EXPRESSED
 *       "transformation script has been validated".
 */
import { describe, expect, it } from 'vitest';
import { TransformationBuilder } from '../src/core/builder.js';
import { CsvDataSource } from '../src/core/data-source.js';
import {
  MemoryDisplayDevice,
  ScriptDebugger,
  VALIDATED_MESSAGE,
} from '../src/core/debugger.js';
import { Ontology } from '../src/core/ontology.js';
import type { TransformationScript } from '../src/core/types.js';

const CSV = 'nome\nAda\n';

function consistentOntology(): Ontology {
  return new Ontology(
    [
      { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
      { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
      { kind: 'object', name: 'Cidade', properties: { nome: 'string' } },
    ],
    [{ name: 'resideEm', from: 'Pessoa', to: 'Cidade' }],
  );
}

function scriptWithTwoConditions(): TransformationScript {
  return new TransformationBuilder('fluxo')
    .defineObject('Pessoa', { nome: 'string' })
    .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
    .defineObject('Cidade', { nome: 'string' })
    .createLink('resideEm', 'Pessoa', 'Cidade')
    .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
    .addCondition({ id: 'c1', entity: 'Endereco', dataItemId: 'row-1' })
    .addCondition({ id: 'c2', entity: 'Pessoa', links: ['resideEm'], dataItemId: 'row-1' })
    .build();
}

describe('ScriptDebugger — fluxo exato expressed/implicit', () => {
  it('(a) condição inválida → resultado EXPRESSED indicando não-validade e depuração falha', () => {
    // Ontologia atribui "Endereco" como OBJETO; builder define como PROPRIEDADE de Pessoa.
    const ontology = new Ontology(
      [
        { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
        { kind: 'object', name: 'Endereco', properties: {} },
        { kind: 'object', name: 'Cidade', properties: { nome: 'string' } },
      ],
      [{ name: 'resideEm', from: 'Pessoa', to: 'Cidade' }],
    );
    const display = new MemoryDisplayDevice();
    const report = new ScriptDebugger(display).run(
      scriptWithTwoConditions(),
      ontology,
      new CsvDataSource(CSV),
    );

    expect(report.success).toBe(false);
    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0]!;
    expect(outcome).toMatchObject({ conditionId: 'c1', kind: 'invalid', valid: false, expressed: true });
    expect(outcome.message).toContain('invalid');
    // A falha é EXPRESSED no display device e a 2ª condição nem é avaliada.
    expect(display.outcomes).toEqual([outcome]);
    expect(display.messages[0]).toContain('c1');
  });

  it('(b) condição válida com subsequente → resultado IMPLICIT (display NÃO é acionado para ela)', () => {
    const display = new MemoryDisplayDevice();
    const report = new ScriptDebugger(display).run(
      scriptWithTwoConditions(),
      consistentOntology(),
      new CsvDataSource(CSV),
    );

    expect(report.success).toBe(true);
    expect(report.outcomes).toHaveLength(2);

    const first = report.outcomes[0]!;
    expect(first).toMatchObject({ conditionId: 'c1', kind: 'implicit', valid: true, expressed: false });
    expect(first.message).toBe('');

    // O display só recebeu o resultado final (validated), nada do implicit.
    expect(display.outcomes).toHaveLength(1);
    expect(display.outcomes[0]!.conditionId).toBe('c2');
  });

  it('(c) última condição válida, sem subsequentes → EXPRESSED "transformation script has been validated"', () => {
    const display = new MemoryDisplayDevice();
    const report = new ScriptDebugger(display).run(
      scriptWithTwoConditions(),
      consistentOntology(),
      new CsvDataSource(CSV),
    );

    const last = report.outcomes.at(-1)!;
    expect(last).toMatchObject({ conditionId: 'c2', kind: 'validated', valid: true, expressed: true });
    expect(last.message).toBe(VALIDATED_MESSAGE);
    expect(last.message).toBe('transformation script has been validated');
    expect(display.messages).toEqual([VALIDATED_MESSAGE]);
  });

  it('condição única válida → apenas o resultado EXPRESSED validated', () => {
    const script = new TransformationBuilder('s')
      .defineObject('Pessoa', { nome: 'string' })
      .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
      .addCondition({ id: 'only', entity: 'Pessoa', dataItemId: 'row-1' })
      .build();
    const ontology = new Ontology([{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }]);
    const display = new MemoryDisplayDevice();
    const report = new ScriptDebugger(display).run(script, ontology, new CsvDataSource(CSV));

    expect(report.success).toBe(true);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]!.kind).toBe('validated');
    expect(display.messages).toEqual([VALIDATED_MESSAGE]);
  });

  it('link atribuído inconsistente com o link criado no builder → condição inválida (expressed)', () => {
    const ontology = new Ontology(
      [
        { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
        { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
        { kind: 'object', name: 'Cidade', properties: { nome: 'string' } },
      ],
      [{ name: 'resideEm', from: 'Pessoa', to: 'Pais' }], // extremidade divergente
    );
    const display = new MemoryDisplayDevice();
    const report = new ScriptDebugger(display).run(
      scriptWithTwoConditions(),
      ontology,
      new CsvDataSource(CSV),
    );

    expect(report.success).toBe(false);
    // c1 é válida (implicit); c2 falha pelo link.
    expect(report.outcomes).toHaveLength(2);
    expect(report.outcomes[0]!.kind).toBe('implicit');
    expect(report.outcomes[1]!.kind).toBe('invalid');
    expect(report.outcomes[1]!.reasons.join(' ')).toContain('resideEm');
    expect(display.messages).toHaveLength(1);
  });

  it('condição que usa data item não importado → inválida', () => {
    const script = new TransformationBuilder('s')
      .defineObject('Pessoa', { nome: 'string' })
      .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-99' })
      .addCondition({ id: 'c1', entity: 'Pessoa', dataItemId: 'row-99' })
      .build();
    const ontology = new Ontology([{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }]);
    const report = new ScriptDebugger(new MemoryDisplayDevice()).run(script, ontology, new CsvDataSource(CSV));
    expect(report.success).toBe(false);
    expect(report.outcomes[0]!.reasons.join(' ')).toContain('não foi importado');
  });

  it('determinismo: duas execuções produzem relatórios idênticos', () => {
    const run = () =>
      new ScriptDebugger(new MemoryDisplayDevice()).run(
        scriptWithTwoConditions(),
        consistentOntology(),
        new CsvDataSource(CSV),
      );
    expect(run()).toEqual(run());
  });
});
