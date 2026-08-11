import { describe, expect, it } from 'vitest';
import {
  RENDER_FORMS,
  rendererRegistry,
  renderAcronym,
  renderErrorMessage,
  renderGraphic,
  renderIndication,
  renderNumber,
} from '../src/core/renderers.js';
import { resultsFromVerdicts } from '../src/core/results.js';

const [invalid] = resultsFromVerdicts([
  {
    conditionId: 'c1',
    valid: false,
    reasons: [
      {
        code: 'entity-inconsistent',
        detail: "entidade 'nome' atribuída como objeto, mas definida como propriedade de 'Cliente'",
      },
    ],
  },
]);
const [valid] = resultsFromVerdicts([{ conditionId: 'c2', valid: true, reasons: [] }]);

describe('renderer (1) error message — saída exata', () => {
  it('inválido', () => {
    expect(renderErrorMessage(invalid!)).toBe(
      "ERRO de validação — condição 'c1': atribuição da entidade inconsistente com a definição. Detalhes: entidade 'nome' atribuída como objeto, mas definida como propriedade de 'Cliente'",
    );
  });
  it('válido', () => {
    expect(renderErrorMessage(valid!)).toBe("OK — script validated (condição 'c2')");
  });
});

describe('renderer (2) acronym — saída exata', () => {
  it('inválido', () => {
    expect(renderAcronym(invalid!)).toBe('EINV-ENT-001');
  });
  it('válido', () => {
    expect(renderAcronym(valid!)).toBe('SVAL-OK-000');
  });
});

describe('renderer (3) number — saída exata', () => {
  it('inválido', () => {
    expect(renderNumber(invalid!)).toBe('1001');
  });
  it('válido', () => {
    expect(renderNumber(valid!)).toBe('9000');
  });
});

describe('renderer (4) graphic — painel ASCII, saída exata', () => {
  it('inválido', () => {
    expect(renderGraphic(invalid!)).toBe(
      [
        '+--------------------------------------------+',
        '| ALERTA DE VALIDACAO                        |',
        '+--------------------------------------------+',
        '| Condicao: c1                               |',
        '| Codigo  : EINV-ENT-001                     |',
        '| Numero  : 1001                             |',
        "| Detalhe : entidade 'nome' atribuída com... |",
        '+--------------------------------------------+',
      ].join('\n'),
    );
  });
  it('válido', () => {
    expect(renderGraphic(valid!)).toBe(
      [
        '+--------------------------------------------+',
        '| VALIDACAO CONCLUIDA                        |',
        '+--------------------------------------------+',
        '| Condicao: c2                               |',
        '| Codigo  : SVAL-OK-000                      |',
        '| Numero  : 9000                             |',
        "| Detalhe : condição 'c2' validada; scrip... |",
        '+--------------------------------------------+',
      ].join('\n'),
    );
  });
  it('todas as linhas têm largura fixa de 46 colunas', () => {
    for (const line of renderGraphic(invalid!).split('\n')) {
      expect(line).toHaveLength(46);
    }
  });
});

describe('registry de renderers', () => {
  it('registra as 4 formas', () => {
    expect(RENDER_FORMS).toEqual(['message', 'acronym', 'number', 'graphic']);
    expect(Object.keys(rendererRegistry).sort()).toEqual([...RENDER_FORMS].sort());
  });
  it('renderIndication delega para o renderer da forma', () => {
    expect(renderIndication(invalid!, 'acronym')).toBe('EINV-ENT-001');
    expect(renderIndication(valid!, 'number')).toBe('9000');
  });
});
