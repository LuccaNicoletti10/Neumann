/**
 * cli-script-debugger — tests/indication.test.ts
 * Testa a indicação do resultado: implicit/expressed, 4 formas × 3 sinks,
 * com sinks injetáveis capturáveis.
 */
import { describe, expect, it } from 'vitest';

import {
  buildIndication,
  createDebuggerSink,
  createEmailSink,
  createPopupSink,
  createSinkFor,
  dispatchIndication,
} from '../src/core/indication.js';
import type { IndicationSink } from '../src/core/indication.js';
import type {
  Indication,
  IndicationForm,
  SinkChannel,
  Verdict,
} from '../src/core/types.js';

const INVALID_VERDICT: Verdict = {
  valid: false,
  issues: [
    { code: 'INCONSISTENT_ASSIGNMENT', message: 'atribuição inconsistente', parameter: 'p1' },
    { code: 'INVALID_MAPPING', message: 'mapping inválido', parameter: 'p2' },
    { code: 'INVALID_MAPPING', message: 'outro mapping inválido', parameter: 'p3' },
  ],
  stats: { items: 2, evaluated: 4, failed: 1 },
};

const VALID_VERDICT: Verdict = {
  valid: true,
  issues: [],
  stats: { items: 2, evaluated: 4, failed: 0 },
};

const FORMS: readonly IndicationForm[] = ['message', 'acronym', 'number', 'graphic'];
const CHANNELS: readonly SinkChannel[] = ['debugger', 'email', 'popup'];

describe('indicação implicit × expressed', () => {
  it('válido → implicit', () => {
    expect(buildIndication(VALID_VERDICT, 'message').kind).toBe('implicit');
  });

  it('inválido → expressed', () => {
    expect(buildIndication(INVALID_VERDICT, 'message').kind).toBe('expressed');
  });
});

describe('4 formas de indicação expressa', () => {
  it('message: descreve os problemas', () => {
    const i = buildIndication(INVALID_VERDICT, 'message');
    expect(i.content).toContain('ERRO');
    expect(i.content).toContain('3 problema(s)');
    expect(i.content).toContain('atribuição inconsistente');
  });

  it('acronym: códigos únicos ordenados', () => {
    const i = buildIndication(INVALID_VERDICT, 'acronym');
    expect(i.content).toBe('ERR:INCONSISTENT_ASSIGNMENT+INVALID_MAPPING');
  });

  it('number: quantidade de problemas', () => {
    expect(buildIndication(INVALID_VERDICT, 'number').content).toBe('3');
    expect(buildIndication(VALID_VERDICT, 'number').content).toBe('0');
  });

  it('graphic: barras ASCII por código', () => {
    const i = buildIndication(INVALID_VERDICT, 'graphic');
    expect(i.content).toContain('[INVALID]');
    expect(i.content).toContain('INCONSISTENT_ASSIGNMENT | # 1');
    expect(i.content).toContain('INVALID_MAPPING | ## 2');
    expect(buildIndication(VALID_VERDICT, 'graphic').content).toBe('[OK]');
  });
});

describe('3 canais de entrega (sinks injetáveis)', () => {
  it('debugger/email/popup têm os canais corretos', () => {
    const noop = (): void => undefined;
    expect(createDebuggerSink(noop).channel).toBe('debugger');
    expect(createEmailSink(noop).channel).toBe('email');
    expect(createPopupSink(noop).channel).toBe('popup');
  });

  it.each(FORMS.flatMap((form) => CHANNELS.map((channel) => [form, channel] as const)))(
    'forma %s entregue via sink %s',
    (form, channel) => {
      const captured: Indication[] = [];
      const sink: IndicationSink = createSinkFor(channel, (i) => captured.push(i));
      const emitted = dispatchIndication(INVALID_VERDICT, form, [sink]);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual(emitted);
      expect(captured[0]?.form).toBe(form);
      expect(captured[0]?.kind).toBe('expressed');
      expect(sink.channel).toBe(channel);
    },
  );

  it('entrega em múltiplos sinks simultaneamente', () => {
    const a: Indication[] = [];
    const b: Indication[] = [];
    dispatchIndication(INVALID_VERDICT, 'number', [
      createEmailSink((i) => a.push(i)),
      createPopupSink((i) => b.push(i)),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.content).toBe('3');
  });
});
