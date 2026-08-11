import { describe, expect, it } from 'vitest';
import { createDefaultChannels } from '../src/core/channels.js';
import { ValidationNotifier, type NotifyRunInput } from '../src/core/notifier.js';
import { createTransformationScript, importDataItems } from '../src/core/validation.js';
import type { TransformationScript } from '../src/core/types.js';

function scriptFlow(): TransformationScript {
  // c1: válida (intermediária) · c2: inválida (entidade inconsistente) · c3: válida (última)
  return createTransformationScript('fluxo')
    .defineEntityAsObject('Cliente')
    .defineEntityAsProperty('nome', 'Cliente')
    .addOntologyParameter({
      name: 'p-nome',
      defines: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      acceptedTypes: ['record'],
    })
    .addCondition({
      id: 'c1',
      description: 'válida intermediária',
      assignment: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
      mappings: [{ dataItemId: 'a1', parameterName: 'p-nome' }],
    })
    .addCondition({
      id: 'c2',
      description: 'inválida',
      assignment: { entity: 'nome', kind: 'object' },
      mappings: [],
    })
    .addCondition({
      id: 'c3',
      description: 'válida final',
      assignment: { entity: 'Cliente', kind: 'object' },
      mappings: [],
    })
    .build();
}

function makeInput(notify?: NotifyRunInput['notify']): NotifyRunInput {
  return {
    script: scriptFlow(),
    dataItems: importDataItems({ format: 'csv', content: 'id,nome\na1,Ada' }),
    ...(notify !== undefined ? { notify } : {}),
  };
}

describe('ValidationNotifier — fluxo completo do mecanismo 5', () => {
  it('inválido→expressed entregue; válido+subsequente→implicit NÃO entregue; válido+última→expressed "script validated"', () => {
    const defaults = createDefaultChannels();
    const notifier = new ValidationNotifier(defaults.channels);
    const output = notifier.run(makeInput({ channel: 'debugger' }));

    expect(output.results.map((r) => [r.verdict.conditionId, r.kind])).toEqual([
      ['c1', 'implicit'],
      ['c2', 'expressed'],
      ['c3', 'expressed'],
    ]);
    // implicit (c1) nunca é entregue
    expect(output.delivered.map((d) => d.conditionId)).toEqual(['c2', 'c3']);
    expect(defaults.debuggerSink.delivered.map((d) => d.conditionId)).toEqual(['c2', 'c3']);
    // última válida expressa "script validated"
    const last = output.delivered[1];
    expect(last?.content).toBe("OK — script validated (condição 'c3')");
    // inválida expressa o erro
    expect(output.delivered[0]?.content).toContain('ERRO de validação');
  });

  it('resultado implicit NÃO é entregue em nenhum canal', () => {
    const defaults = createDefaultChannels();
    const notifier = new ValidationNotifier(defaults.channels);
    notifier.run(makeInput({ channel: 'popup', form: 'graphic' }));
    expect(defaults.debuggerSink.delivered).toHaveLength(0);
    expect(defaults.mailSender.sent).toHaveLength(0);
    expect(defaults.popupSink.shown.map((p) => p.title)).toEqual(['Validação — c2', 'Validação — c3']);
  });

  it('canal e forma configurados são respeitados (email + acronym)', () => {
    const defaults = createDefaultChannels();
    const notifier = new ValidationNotifier(defaults.channels);
    const output = notifier.run(makeInput({ channel: 'email', form: 'acronym' }));
    expect(defaults.mailSender.sent.map((m) => m.body)).toEqual(['EINV-ENT-001', 'SVAL-OK-000']);
    expect(output.delivered.every((d) => d.channel === 'email' && d.form === 'acronym')).toBe(true);
  });

  it('sem canal explícito, roteia por severidade (error→popup, info→debugger)', () => {
    const defaults = createDefaultChannels();
    const notifier = new ValidationNotifier(defaults.channels);
    notifier.run(
      makeInput({
        form: 'number',
        router: { fallback: 'debugger', bySeverity: { error: 'popup' } },
      }),
    );
    expect(defaults.popupSink.shown.map((p) => p.message)).toEqual(['1001']);
    expect(defaults.debuggerSink.delivered.map((d) => d.content)).toEqual(['9000']);
  });

  it('forma graphic entregue no popup renderiza o painel ASCII', () => {
    const defaults = createDefaultChannels();
    const notifier = new ValidationNotifier(defaults.channels);
    notifier.run(makeInput({ channel: 'popup', form: 'graphic' }));
    const first = defaults.popupSink.shown[0];
    expect(first?.message).toContain('+--------------------------------------------+');
    expect(first?.message).toContain('| Codigo  : EINV-ENT-001                     |');
  });

  it('script totalmente válido entrega apenas o "script validated" final', () => {
    const script = createTransformationScript('ok')
      .defineEntityAsObject('A')
      .addCondition({ id: 'v1', description: '', assignment: { entity: 'A', kind: 'object' }, mappings: [] })
      .addCondition({ id: 'v2', description: '', assignment: { entity: 'A', kind: 'object' }, mappings: [] })
      .build();
    const defaults = createDefaultChannels();
    const notifier = new ValidationNotifier(defaults.channels);
    const output = notifier.run({ script, dataItems: [], notify: { channel: 'debugger' } });
    expect(output.delivered).toHaveLength(1);
    expect(output.delivered[0]?.conditionId).toBe('v2');
    expect(output.delivered[0]?.severity).toBe('info');
  });
});
