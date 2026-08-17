/**
 * policy-engine — tests/noninterference.test.ts
 * Passo 28: 8 canais + fuzzing (WO2022245989 / US 10,044,745).
 */
import { describe, expect, it } from 'vitest';

import { fingerprintsEqual, HIDDEN_MISS, NONINTERFERENCE_CHANNELS } from 'contracts';

import { runNoninterferenceDemo } from '../src/cli.js';
import { oracleAuthorize, runAuthzFuzz } from '../src/core/authz-fuzzer.js';
import { completeAuthorized, embedAuthorized } from '../src/core/closed-channels.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createPolicyEngine } from '../src/core/engine.js';
import { logFingerprint, sanitizeLogLine } from '../src/core/log-redact.js';
import {
  NI_SECRET,
  probePrincipal,
  runNoninterferenceSuite,
  seedWorld,
} from '../src/core/noninterference.js';
import { createPrincipalCache } from '../src/core/principal-cache.js';

function eng() {
  return createPolicyEngine({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 28 — noninterference + fuzz', () => {
  it('8 canais: Bob Unclassified não distingue mundo-com-segredo de mundo-sem-segredo', () => {
    const report = runNoninterferenceSuite();
    expect(report.present.observations.map((o) => o.channel)).toEqual([...NONINTERFERENCE_CHANNELS]);
    expect(report.leaked).toEqual([]);
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report.present)).not.toContain(NI_SECRET);
    expect(JSON.stringify(report.absent)).not.toContain(NI_SECRET);
  });

  it('Alice (com acesso) distingue os mundos — o harness não é vacuoso', () => {
    const a = probePrincipal(seedWorld(true), 'alice');
    const b = probePrincipal(seedWorld(false), 'alice');
    expect(fingerprintsEqual(a, b).length).toBeGreaterThan(0);
  });

  it('authorize: deny ≡ miss (reason + resourceEpid)', () => {
    const e = eng();
    e.grantPolicy('bob', 'ops');
    e.addNode({ id: 'n1', resourceId: 'secret', policy: 'finance', parentId: null });

    const denied = e.authorize({ principal: 'bob', resource: 'secret', operation: 'read' });
    const missing = e.authorize({ principal: 'bob', resource: 'ghost', operation: 'read' });
    expect(denied.decision).toBe('deny');
    expect(missing.decision).toBe('deny');
    expect(denied.reason).toBe('not found');
    expect(missing.reason).toBe('not found');
    expect(denied.resourceEpid).toBeNull();
    expect(missing.resourceEpid).toBeNull();
  });

  it('securedRead count é 0 (nunca null) quando nada é visível', () => {
    const e = eng();
    e.grantPolicy('bob', 'ops');
    e.addNode({ id: 'n1', resourceId: 'secret', policy: 'finance', parentId: null });
    const view = e.securedRead('bob', [{ resourceId: 'secret' }, { resourceId: 'ghost' }]);
    expect(view.items).toEqual([]);
    expect(view.count).toBe(0);
    expect(view.matrix).toEqual([]);
  });

  it('cache de Alice não serve Bob', () => {
    const cache = createPrincipalCache();
    cache.set('alice', 'obj-c2', NI_SECRET);
    expect(cache.get('alice', 'obj-c2')).toBe(NI_SECRET);
    expect(cache.get('bob', 'obj-c2')).toBeUndefined();
    expect(cache.has('bob', 'obj-c2')).toBe(false);
  });

  it('embeddings/LLM fail-closed: sem leitura → vetor vazio / completion vazia', () => {
    const deny = () => false;
    expect(embedAuthorized(deny, 'bob', 'obj-c2', NI_SECRET)).toEqual([]);
    expect(completeAuthorized(deny, 'bob', 'obj-c2', `summarize ${NI_SECRET}`)).toBe('');
  });

  it('logs observáveis não carregam o payload secreto', () => {
    const line = `lookup obj-c2 payload=${NI_SECRET}`;
    expect(sanitizeLogLine(line, [NI_SECRET])).not.toContain(NI_SECRET);
    expect(logFingerprint([line], [NI_SECRET])).not.toContain(NI_SECRET);
  });

  it('oracle bate com o engine nos casos canônicos', () => {
    const leaf = {
      resourceId: 'ds-leaf',
      effectivePolicy: 'finance',
      explicitPolicy: false,
    };
    expect(oracleAuthorize(['finance'], leaf, 'read')).toBe('allow');
    expect(oracleAuthorize(['finance'], leaf, 'modify')).toBe('partial');
    expect(oracleAuthorize(['ops'], leaf, 'read')).toBe('deny');
    expect(oracleAuthorize(['finance'], undefined, 'read')).toBe('deny');
  });

  it('fuzzer 200 rounds sem violação (seed 28)', () => {
    const fuzz = runAuthzFuzz({
      engine: eng(),
      seed: 28,
      rounds: 200,
    });
    expect(fuzz.rounds).toBe(200);
    expect(fuzz.violations).toEqual([]);
  });

  it('CLI policy ni exit 0', () => {
    const lines: string[] = [];
    expect(runNoninterferenceDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('ni ok'))).toBe(true);
    expect(lines.some((l) => l.includes(NI_SECRET))).toBe(false);
  });

  it('HIDDEN_MISS envelope canônico', () => {
    expect(HIDDEN_MISS).toEqual({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
      errorName: 'ResourceNotFound',
      message: 'not found',
    });
  });
});
