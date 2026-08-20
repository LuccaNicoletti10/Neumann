/**
 * contracts — aip-eval assert + adversarial coverage.
 */
import { describe, expect, it } from 'vitest';

import {
  AIP_ADVERSARIAL_KINDS,
  assertAipEvalCase,
} from '../src/v1/aip-eval.js';

describe('aip-eval contracts', () => {
  it('assertAipEvalCase accepts valid case', () => {
    const c = assertAipEvalCase({
      id: 't1',
      version: '1',
      mode: 'ask',
      input: 'hi',
      allowedTools: ['get_object'],
      rubric: {},
      modelVersion: 'm',
      promptVersion: 'p',
      agentVersion: 'a',
      adversarial: 'exfiltration',
    });
    expect(c.adversarial).toBe('exfiltration');
  });

  it('assertAipEvalCase rejects unknown adversarial', () => {
    expect(() =>
      assertAipEvalCase({
        id: 't1',
        version: '1',
        mode: 'ask',
        input: 'hi',
        allowedTools: [],
        rubric: {},
        modelVersion: 'm',
        promptVersion: 'p',
        agentVersion: 'a',
        adversarial: 'not-a-real-attack',
      }),
    ).toThrow(/unknown adversarial/);
  });

  it('lists exactly 11 adversarials', () => {
    expect(AIP_ADVERSARIAL_KINDS).toHaveLength(11);
  });
});
