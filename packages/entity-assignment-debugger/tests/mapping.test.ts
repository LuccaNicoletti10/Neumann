/**
 * Testes do mapping data item → parâmetros da ontologia: mapping para parâmetro
 * existente e compatível é válido; para parâmetro inexistente ou incompatível
 * torna a condição inválida (componente da patente US 9,984,152 B2).
 */
import { describe, expect, it } from 'vitest';
import { TransformationBuilder } from '../src/core/builder.js';
import { CsvDataSource } from '../src/core/data-source.js';
import { MemoryDisplayDevice, ScriptDebugger } from '../src/core/debugger.js';
import { Ontology } from '../src/core/ontology.js';

const CSV = 'nome,idade\nAda,36\n';

function runWith(mapping: { dataItemField: string; entity: string; parameter: string }) {
  const script = new TransformationBuilder('s')
    .defineObject('Pessoa', { nome: 'string', idade: 'number' })
    .addMapping({ ...mapping, dataItemId: 'row-1' })
    .addCondition({ id: 'c1', entity: 'Pessoa', dataItemId: 'row-1' })
    .build();
  const ontology = new Ontology([
    { kind: 'object', name: 'Pessoa', properties: { nome: 'string', idade: 'number' } },
  ]);
  const display = new MemoryDisplayDevice();
  const report = new ScriptDebugger(display).run(script, ontology, new CsvDataSource(CSV));
  return { report, display };
}

describe('Mapping data item → parâmetro da ontologia', () => {
  it('mapping para parâmetro existente e compatível → condição válida', () => {
    const { report } = runWith({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome' });
    expect(report.success).toBe(true);
    expect(report.outcomes[0]!.kind).toBe('validated');
  });

  it('mapping para parâmetro INEXISTENTE → condição inválida (expressed)', () => {
    const { report, display } = runWith({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'cpf' });
    expect(report.success).toBe(false);
    expect(report.outcomes[0]!.kind).toBe('invalid');
    expect(report.outcomes[0]!.expressed).toBe(true);
    expect(report.outcomes[0]!.reasons.join(' ')).toContain('parâmetro inexistente');
    expect(display.messages).toHaveLength(1);
  });

  it('mapping para parâmetro com tipo INCOMPATÍVEL → condição inválida', () => {
    const script = new TransformationBuilder('s')
      .defineObject('Pessoa', { nome: 'string' })
      .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
      .addCondition({ id: 'c1', entity: 'Pessoa', dataItemId: 'row-1' })
      .build();
    // Ontologia atribui "nome" como number; builder define como string.
    const ontology = new Ontology([
      { kind: 'object', name: 'Pessoa', properties: { nome: 'number' } },
    ]);
    const report = new ScriptDebugger(new MemoryDisplayDevice()).run(script, ontology, new CsvDataSource(CSV));
    expect(report.success).toBe(false);
    expect(report.outcomes[0]!.reasons.join(' ')).toContain('tipo incompatível');
  });

  it('mapping para entidade atribuída como propriedade (sem parâmetros) → condição inválida', () => {
    const script = new TransformationBuilder('s')
      .defineObject('Pessoa', { nome: 'string' })
      .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome' })
      .addCondition({ id: 'c1', entity: 'Pessoa' })
      .build();
    const ontology = new Ontology([
      { kind: 'property', name: 'Pessoa', owner: 'Empresa', valueType: 'string' },
    ]);
    const report = new ScriptDebugger(new MemoryDisplayDevice()).run(script, ontology, new CsvDataSource(CSV));
    expect(report.success).toBe(false);
    expect(report.outcomes[0]!.reasons.join(' ')).toContain('propriedade, não como objeto');
  });

  it('mapping de campo ausente no data item usado pela condição → condição inválida', () => {
    const { report } = runWith({ dataItemField: 'sobrenome', entity: 'Pessoa', parameter: 'nome' });
    expect(report.success).toBe(false);
    expect(report.outcomes[0]!.reasons.join(' ')).toContain('campo ausente no data item');
  });
});
