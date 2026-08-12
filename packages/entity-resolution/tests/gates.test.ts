/**
 * entity-resolution — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { runDemo } from '../src/cli.js';
import { buildBlockIndex, enumerateCandidatePairs, fullCartesianCount } from '../src/core/blocking.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createEntityResolver } from '../src/core/engine.js';
import {
  normalizeDocument,
  normalizeEmail,
  normalizeRecord,
  normalizeText,
} from '../src/core/normalize.js';
import { nameSimilarity, scorePair } from '../src/core/scoring.js';
import { buildGoldenCriteria } from 'contracts';

function er() {
  return createEntityResolver({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 20 gates — normalização', () => {
  it('lowercase + sem acentos + pontuação', () => {
    expect(normalizeText('ACME LTDA')).toBe('acme ltda');
    expect(normalizeText('Acme Ltda.')).toBe('acme ltda');
    expect(normalizeText('São Paulo')).toBe('sao paulo');
  });

  it('CNPJ só dígitos', () => {
    expect(normalizeDocument('12.345.678/0001-90')).toBe('12345678000190');
  });

  it('email minúsculo', () => {
    expect(normalizeEmail('Contato@ACME.com.br')).toBe('contato@acme.com.br');
  });
});

describe('Passo 20 gates — blocking (T3.6)', () => {
  it('nunca compara fora do bloco / < cartesiano', () => {
    const records = [
      normalizeRecord({
        id: 'a',
        objectTypeId: 'ot.customer',
        properties: { name: 'ACME LTDA', document: '111' },
      }),
      normalizeRecord({
        id: 'b',
        objectTypeId: 'ot.customer',
        properties: { name: 'Acme Ltda.', document: '111' },
      }),
      normalizeRecord({
        id: 'c',
        objectTypeId: 'ot.customer',
        properties: { name: 'Zeta SA', document: '999' },
      }),
      normalizeRecord({
        id: 'd',
        objectTypeId: 'ot.other',
        properties: { name: 'ACME LTDA', document: '111' },
      }),
    ];
    const index = buildBlockIndex(records);
    const pairs = enumerateCandidatePairs(records, index);
    const cartesian = fullCartesianCount(records.length);
    expect(pairs.length).toBeLessThan(cartesian);
    // a-b compartilham doc/name; d é outro ObjectType → não entra com a/b
    expect(pairs.every(([l, r]) => l.objectTypeId === r.objectTypeId)).toBe(true);
    expect(pairs.some(([l, r]) => l.recordId === 'a' && r.recordId === 'b')).toBe(true);
    // c (Zeta) não compartilha chave com a — sem par a↔c
    const ac = pairs.find(
      ([l, r]) =>
        (l.recordId === 'a' && r.recordId === 'c') ||
        (l.recordId === 'c' && r.recordId === 'a'),
    );
    expect(ac).toBeUndefined();
  });
});

describe('Passo 20 gates — scoring (T3.7)', () => {
  it('determinístico por rule_version', () => {
    const criteria = buildGoldenCriteria();
    const left = normalizeRecord({
      id: 'a',
      objectTypeId: 'ot.customer',
      properties: { name: 'ACME LTDA', document: '12345678000190' },
    });
    const right = normalizeRecord({
      id: 'b',
      objectTypeId: 'ot.customer',
      properties: { name: 'Acme Ltda.', document: '12345678000190' },
    });
    const s1 = scorePair(left, right, 'block', criteria);
    const s2 = scorePair(left, right, 'block', criteria);
    expect(s1.score).toBe(s2.score);
    expect(s1.decision).toBe('match');
    expect(s1.ruleVersionId).toBe('rules-v1');
  });

  it('nameSimilarity ACME = Acme Ltda', () => {
    expect(nameSimilarity('acme ltda', 'acme ltda')).toBe(1);
  });
});

describe('Passo 20 gates — merge ACME', () => {
  it('"ACME LTDA" + "Acme Ltda." → 1 objeto Customer', () => {
    const result = er().runResolution({
      records: [
        {
          id: 'rec-A',
          objectTypeId: 'ot.customer',
          properties: { name: 'ACME LTDA', document: '12.345.678/0001-90' },
        },
        {
          id: 'rec-B',
          objectTypeId: 'ot.customer',
          properties: { name: 'Acme Ltda.', document: '12345678000190' },
        },
      ],
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.memberIds.sort()).toEqual(['rec-A', 'rec-B']);
    expect(result.clusters[0]!.objectTypeId).toBe('ot.customer');
    expect(result.candidates[0]!.decision).toBe('match');
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
