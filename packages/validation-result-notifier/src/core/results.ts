/**
 * validation-result-notifier — src/core/results.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: resultado IMPLICIT vs EXPRESSED — o resultado da
 * determinação é implicit (não exibido ao usuário; usado internamente para
 * prosseguir) ou expressed (exibido). Fluxo do debug run:
 *   - condição inválida                       → expressed
 *   - condição válida com subsequentes        → implicit
 *   - condição válida sendo a última          → expressed "script validated"
 */

import type {
  InvalidReasonCode,
  ResultKind,
  Severity,
  ValidationVerdict,
} from './types.js';

/** Conteúdo canônico e determinístico de um resultado, pronto para renderização. */
export interface ValidationResultPayload {
  headline: string;
  detail: string;
  acronym: string;
  numericCode: number;
  severity: Severity;
}

export interface ValidationResult {
  kind: ResultKind;
  verdict: ValidationVerdict;
  payload: ValidationResultPayload;
}

interface CodeEntry {
  acronym: string;
  numericCode: number;
  headline: string;
}

/** Tabela determinística: razão de invalidade → sigla, número e título. */
const REASON_CODES: Record<InvalidReasonCode, CodeEntry> = {
  'entity-inconsistent': {
    acronym: 'EINV-ENT-001',
    numericCode: 1001,
    headline: 'atribuição da entidade inconsistente com a definição',
  },
  'mapping-incompatible': {
    acronym: 'EINV-MAP-002',
    numericCode: 1002,
    headline: 'mapping incompatível com o parâmetro ontológico',
  },
  'data-item-missing': {
    acronym: 'EINV-MAP-003',
    numericCode: 1003,
    headline: 'data item referenciado não encontrado na fonte',
  },
  'source-requirement-unmet': {
    acronym: 'EINV-FON-004',
    numericCode: 1004,
    headline: 'requisito da condição sobre o data source não atendido',
  },
};

const VALID_ENTRY: CodeEntry = {
  acronym: 'SVAL-OK-000',
  numericCode: 9000,
  headline: 'script validated',
};

/** Constrói o payload canônico do resultado a partir do veredito. */
export function payloadFor(verdict: ValidationVerdict): ValidationResultPayload {
  if (verdict.valid) {
    return {
      headline: VALID_ENTRY.headline,
      detail: `condição '${verdict.conditionId}' validada; script validated`,
      acronym: VALID_ENTRY.acronym,
      numericCode: VALID_ENTRY.numericCode,
      severity: 'info',
    };
  }
  const first = verdict.reasons[0];
  const entry = first !== undefined ? REASON_CODES[first.code] : REASON_CODES['entity-inconsistent'];
  return {
    headline: entry.headline,
    detail: verdict.reasons.map((reason) => reason.detail).join('; '),
    acronym: entry.acronym,
    numericCode: entry.numericCode,
    severity: 'error',
  };
}

/**
 * Converte a sequência de vereditos do debug run na sequência de resultados,
 * aplicando a regra implicit/expressed do fluxo.
 */
export function resultsFromVerdicts(verdicts: ValidationVerdict[]): ValidationResult[] {
  return verdicts.map((verdict, index) => {
    const payload = payloadFor(verdict);
    let kind: ResultKind;
    if (!verdict.valid) {
      // Condição inválida → resultado expressed (exibido ao usuário).
      kind = 'expressed';
    } else if (index < verdicts.length - 1) {
      // Condição válida com subsequentes → implicit (usado internamente p/ prosseguir).
      kind = 'implicit';
    } else {
      // Condição válida sendo a última → expressed "script validated".
      kind = 'expressed';
    }
    return { kind, verdict, payload };
  });
}

/** Resultados expressed (exibíveis) de uma sequência. */
export function expressedResults(results: ValidationResult[]): ValidationResult[] {
  return results.filter((result) => result.kind === 'expressed');
}
