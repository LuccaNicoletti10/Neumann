/**
 * contracts — tests/noninterference.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  assertHiddenMiss,
  fingerprintsEqual,
  HIDDEN_MISS,
  NONINTERFERENCE_CHANNELS,
  type ProbeResult,
} from '../src/v1/noninterference.js';

describe('contracts — noninterference (Passo 28)', () => {
  it('HIDDEN_MISS é 404 canônico', () => {
    expect(HIDDEN_MISS.statusCode).toBe(404);
    expect(HIDDEN_MISS.errorCode).toBe('NOT_FOUND');
    expect(HIDDEN_MISS.message).toBe('not found');
    assertHiddenMiss(HIDDEN_MISS);
  });

  it('8 canais congelados', () => {
    expect(NONINTERFERENCE_CHANNELS).toEqual([
      'count',
      'error',
      'autocomplete',
      'index',
      'embeddings',
      'cache',
      'llm',
      'logs',
    ]);
  });

  it('fingerprintsEqual lista só canais divergentes', () => {
    const mk = (n: string): ProbeResult => ({
      principal: 'bob',
      observations: NONINTERFERENCE_CHANNELS.map((channel) => ({
        channel,
        fingerprint: channel === 'count' ? n : 'same',
      })),
    });
    expect(fingerprintsEqual(mk('1'), mk('1'))).toEqual([]);
    expect(fingerprintsEqual(mk('1'), mk('2'))).toEqual(['count']);
  });
});
