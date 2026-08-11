import { describe, expect, it } from 'vitest';
import { expressedResults, payloadFor, resultsFromVerdicts } from '../src/core/results.js';
import type { ValidationVerdict } from '../src/core/types.js';

const ok = (conditionId: string): ValidationVerdict => ({ conditionId, valid: true, reasons: [] });
const bad = (conditionId: string): ValidationVerdict => ({
  conditionId,
  valid: false,
  reasons: [{ code: 'entity-inconsistent', detail: 'det' }],
});

describe('fluxo implicit/expressed (regra do mecanismo 5)', () => {
  it('condição INVÁLIDA → expressed', () => {
    const results = resultsFromVerdicts([bad('c1')]);
    expect(results[0]?.kind).toBe('expressed');
  });

  it('condição VÁLIDA com subsequentes → implicit', () => {
    const results = resultsFromVerdicts([ok('c1'), ok('c2'), ok('c3')]);
    expect(results.map((r) => r.kind)).toEqual(['implicit', 'implicit', 'expressed']);
  });

  it("condição VÁLIDA sendo a última → expressed 'script validated'", () => {
    const results = resultsFromVerdicts([ok('c1')]);
    expect(results[0]?.kind).toBe('expressed');
    expect(results[0]?.payload.headline).toBe('script validated');
  });

  it('sequência mista: inválida expressed mesmo no meio; válidas intermediárias implicit', () => {
    const results = resultsFromVerdicts([ok('c1'), bad('c2'), ok('c3'), bad('c4'), ok('c5')]);
    expect(results.map((r) => [r.verdict.conditionId, r.kind])).toEqual([
      ['c1', 'implicit'],
      ['c2', 'expressed'],
      ['c3', 'implicit'],
      ['c4', 'expressed'],
      ['c5', 'expressed'],
    ]);
  });

  it('expressedResults filtra apenas os exibíveis', () => {
    const results = resultsFromVerdicts([ok('c1'), bad('c2'), ok('c3')]);
    expect(expressedResults(results).map((r) => r.verdict.conditionId)).toEqual(['c2', 'c3']);
  });
});

describe('payloadFor', () => {
  it('inválido: sigla/número da primeira razão, severidade error', () => {
    const payload = payloadFor({
      conditionId: 'c1',
      valid: false,
      reasons: [
        { code: 'mapping-incompatible', detail: 'd1' },
        { code: 'data-item-missing', detail: 'd2' },
      ],
    });
    expect(payload).toMatchObject({
      acronym: 'EINV-MAP-002',
      numericCode: 1002,
      severity: 'error',
      detail: 'd1; d2',
    });
  });

  it('válido: SVAL-OK-000 / 9000 / info', () => {
    const payload = payloadFor(ok('c9'));
    expect(payload).toMatchObject({ acronym: 'SVAL-OK-000', numericCode: 9000, severity: 'info' });
  });

  it('tabela determinística de códigos por razão', () => {
    const cases: Array<[ValidationVerdict['reasons'][number]['code'], string, number]> = [
      ['entity-inconsistent', 'EINV-ENT-001', 1001],
      ['mapping-incompatible', 'EINV-MAP-002', 1002],
      ['data-item-missing', 'EINV-MAP-003', 1003],
      ['source-requirement-unmet', 'EINV-FON-004', 1004],
    ];
    for (const [code, acronym, numericCode] of cases) {
      const payload = payloadFor({ conditionId: 'c', valid: false, reasons: [{ code, detail: '' }] });
      expect(payload.acronym).toBe(acronym);
      expect(payload.numericCode).toBe(numericCode);
    }
  });
});
