/**
 * execution-sandbox — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createExecutionSandbox } from '../src/core/sandbox.js';
import { runDemo } from '../src/cli.js';

function sbx() {
  const s = createExecutionSandbox({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
    policy: {
      maxCpuMs: 5,
      maxMemoryBytes: 4_000,
      fsAllowPrefixes: ['tmp/'],
      allowNetwork: false,
    },
  });
  s.registerIdentity({
    subjectId: 'u1',
    displayName: 'U',
    roles: ['run'],
  });
  return s;
}

describe('Passo 14 gates', () => {
  it('bloqueia FS escape', () => {
    const s = sbx();
    s.registerTransform('bad', (_i, h) => {
      h.readFile('/etc/passwd');
      return 1;
    });
    const r = s.run({ identityId: 'u1', transformId: 'bad', input: {} });
    expect(r.ok).toBe(false);
    expect(r.deniedReason).toBe('FS_ESCAPE');
  });

  it('bloqueia network', () => {
    const s = sbx();
    s.registerTransform('net', (_i, h) => {
      h.fetch('http://x');
      return 1;
    });
    const r = s.run({ identityId: 'u1', transformId: 'net', input: {} });
    expect(r.deniedReason).toBe('NETWORK_DENIED');
  });

  it('bloqueia timeout CPU', () => {
    const s = sbx();
    s.registerTransform('loop', (_i, h) => {
      h.tick(100);
      return 1;
    });
    const r = s.run({ identityId: 'u1', transformId: 'loop', input: {} });
    expect(r.deniedReason).toBe('TIMEOUT');
  });

  it('audita run ok com identidade', () => {
    const s = sbx();
    s.registerTransform('ok', (input, h) => {
      h.tick(1);
      return input;
    });
    const r = s.run({ identityId: 'u1', transformId: 'ok', input: { a: 1 } });
    expect(r.ok).toBe(true);
    expect(s.auditLog().some((e) => e.ok && e.identityId === 'u1')).toBe(true);
  });

  it('path allowlist exige boundary de prefixo', () => {
    const s = createExecutionSandbox({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      policy: { fsAllowPrefixes: ['tmp/'], allowNetwork: false, maxCpuMs: 5 },
    });
    s.registerIdentity({ subjectId: 'u1', displayName: 'U', roles: ['run'] });
    s.seedFile('tmp/ok.txt', 'x');
    s.registerTransform('read-ok', (_i, h) => h.readFile('tmp/ok.txt'));
    s.registerTransform('read-bad', (_i, h) => h.readFile('tmpsecret/x'));
    expect(s.run({ identityId: 'u1', transformId: 'read-ok', input: {} }).ok).toBe(true);
    expect(
      s.run({ identityId: 'u1', transformId: 'read-bad', input: {} }).deniedReason,
    ).toBe('FS_ESCAPE');
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
  });
});
