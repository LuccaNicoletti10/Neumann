/**
 * cli-script-debugger — src/core/indication.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: INDICAÇÃO DO RESULTADO DO DEBUGGING —
 * IMPLICIT (válido) ou EXPRESSED (inválido), nas formas error message,
 * acronym, number ou graphic, entregue como notificação de debugger
 * application, email ou popup window. Os sinks são injetáveis e capturáveis,
 * mantendo o núcleo puro e determinístico.
 */

import type { Indication, IndicationForm, SinkChannel, Verdict } from './types.js';

/** Constrói a indicação do resultado: implicit quando válido, expressed quando inválido. */
export function buildIndication(verdict: Verdict, form: IndicationForm): Indication {
  return {
    kind: verdict.valid ? 'implicit' : 'expressed',
    form,
    content: render(verdict, form),
  };
}

function render(verdict: Verdict, form: IndicationForm): string {
  switch (form) {
    case 'message':
      return verdict.valid
        ? 'OK: script válido — nenhuma condição inválida encontrada'
        : `ERRO: ${verdict.issues.length} problema(s): ${verdict.issues
            .map((i) => i.message)
            .join(' | ')}`;
    case 'acronym':
      return verdict.valid
        ? 'OK'
        : `ERR:${[...new Set(verdict.issues.map((i) => i.code))].sort().join('+')}`;
    case 'number':
      return String(verdict.issues.length);
    case 'graphic': {
      if (verdict.valid) return '[OK]';
      const counts = new Map<string, number>();
      for (const issue of verdict.issues) {
        counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
      }
      const bars = [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, n]) => `${code} | ${'#'.repeat(n)} ${n}`);
      return ['[INVALID]', ...bars].join('\n');
    }
  }
}

/** Sink injetável de entrega da indicação. */
export interface IndicationSink {
  readonly channel: SinkChannel;
  deliver(indication: Indication): void;
}

/** Sink de notificação de debugger application. */
export function createDebuggerSink(send: (indication: Indication) => void): IndicationSink {
  return { channel: 'debugger', deliver: send };
}

/** Sink de email. */
export function createEmailSink(send: (indication: Indication) => void): IndicationSink {
  return { channel: 'email', deliver: send };
}

/** Sink de popup window. */
export function createPopupSink(send: (indication: Indication) => void): IndicationSink {
  return { channel: 'popup', deliver: send };
}

/** Cria o sink do canal informado, com função de envio injetável (capturável em testes). */
export function createSinkFor(
  channel: SinkChannel,
  send: (indication: Indication) => void,
): IndicationSink {
  switch (channel) {
    case 'debugger':
      return createDebuggerSink(send);
    case 'email':
      return createEmailSink(send);
    case 'popup':
      return createPopupSink(send);
  }
}

/** Constrói a indicação e a entrega em todos os sinks; retorna o que foi emitido. */
export function dispatchIndication(
  verdict: Verdict,
  form: IndicationForm,
  sinks: readonly IndicationSink[],
): Indication {
  const indication = buildIndication(verdict, form);
  for (const sink of sinks) sink.deliver(indication);
  return indication;
}
