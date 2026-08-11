/**
 * validation-result-notifier — src/core/renderers.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: formas de indicação de um resultado EXPRESSED —
 * (1) error message em texto, (2) acronym/código sigla (ex.: EINV-ENT-001),
 * (3) number/código numérico de erro e (4) graphic/renderização gráfica ASCII
 * de um painel de alerta. Inclui o registry de renderers.
 */

import type { ValidationResult } from './results.js';

export type RenderForm = 'message' | 'acronym' | 'number' | 'graphic';

export type Renderer = (result: ValidationResult) => string;

/** (1) Error message em texto. */
export function renderErrorMessage(result: ValidationResult): string {
  const { verdict, payload } = result;
  if (verdict.valid) {
    return `OK — script validated (condição '${verdict.conditionId}')`;
  }
  return `ERRO de validação — condição '${verdict.conditionId}': ${payload.headline}. Detalhes: ${payload.detail}`;
}

/** (2) Acronym / código sigla (ex.: EINV-ENT-001). */
export function renderAcronym(result: ValidationResult): string {
  return result.payload.acronym;
}

/** (3) Number / código numérico de erro. */
export function renderNumber(result: ValidationResult): string {
  return String(result.payload.numericCode);
}

const PANEL_WIDTH = 46;
const INNER_WIDTH = PANEL_WIDTH - 4; // "| " + conteúdo + " |"

function fit(text: string, width: number): string {
  if (text.length > width) {
    return `${text.slice(0, width - 3)}...`;
  }
  return text.padEnd(width, ' ');
}

function panelLine(content: string): string {
  return `| ${fit(content, INNER_WIDTH)} |`;
}

/** (4) Graphic / painel de alerta renderizado em ASCII (determinístico). */
export function renderGraphic(result: ValidationResult): string {
  const { verdict, payload } = result;
  const border = `+${'-'.repeat(PANEL_WIDTH - 2)}+`;
  const title = verdict.valid ? 'VALIDACAO CONCLUIDA' : 'ALERTA DE VALIDACAO';
  const detail = payload.detail === '' ? '-' : payload.detail;
  return [
    border,
    panelLine(title),
    border,
    panelLine(`Condicao: ${verdict.conditionId}`),
    panelLine(`Codigo  : ${payload.acronym}`),
    panelLine(`Numero  : ${payload.numericCode}`),
    panelLine(`Detalhe : ${detail}`),
    border,
  ].join('\n');
}

/** Registry de renderers por forma de indicação. */
export const rendererRegistry: Record<RenderForm, Renderer> = {
  message: renderErrorMessage,
  acronym: renderAcronym,
  number: renderNumber,
  graphic: renderGraphic,
};

export const RENDER_FORMS: readonly RenderForm[] = ['message', 'acronym', 'number', 'graphic'];

/** Renderiza um resultado expressed na forma solicitada. */
export function renderIndication(result: ValidationResult, form: RenderForm): string {
  return rendererRegistry[form](result);
}
