/**
 * policy-engine — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createDeterministicSalt,
  createIdGenerator,
} from '../src/core/determinism.js';
import { createAuditLog } from '../src/core/audit.js';
import { createPolicyEngine } from '../src/core/engine.js';
import { runDemo } from '../src/cli.js';

function eng() {
  return createPolicyEngine({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 16 gates', () => {
  it('authorize allow/deny via EPID', () => {
    const e = eng();
    e.grantPolicy('alice', 'finance');
    e.addNode({ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null });
    e.addNode({ id: 'n2', resourceId: 'r2', policy: 'ops', parentId: null });

    expect(e.authorize({ principal: 'alice', resource: 'r1', operation: 'read' }).decision).toBe(
      'allow',
    );
    expect(e.authorize({ principal: 'alice', resource: 'r2', operation: 'read' }).decision).toBe(
      'deny',
    );
  });

  it('secured read: sem permissão não vê objeto nem count', () => {
    const e = eng();
    e.grantPolicy('bob', 'ops');
    e.addNode({ id: 'n1', resourceId: 'secret', policy: 'finance', parentId: null });

    const view = e.securedRead('bob', [{ resourceId: 'secret', x: 1 }]);
    expect(view.items).toEqual([]);
    expect(view.count).toBeNull();
  });

  it('create resource admissions', () => {
    const e = eng();
    e.grantPolicy('alice', 'finance');
    const root = e.addNode({
      id: 'root',
      resourceId: 'org',
      policy: 'finance',
      parentId: null,
    });
    const ok = e.createResource('alice', {
      resourceId: 'child',
      resourceType: 'dataset',
      parentId: root.id,
      policy: 'finance',
    });
    const deny = e.createResource('eve', {
      resourceId: 'evil',
      resourceType: 'dataset',
      parentId: root.id,
      policy: 'finance',
    });
    expect(ok.ok).toBe(true);
    expect(deny.ok).toBe(false);
  });

  it('audit hash chain detecta adulteração e sobrevive redact', () => {
    const audit = createAuditLog({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      nextSalt: createDeterministicSalt(),
    });
    audit.begin();
    const a = audit.append('event-a', { k: '1' });
    audit.append('event-b', { k: '2' });
    expect(audit.verify().ok).toBe(true);

    const tampered = audit.list().map((e) =>
      e.id === a.id ? { ...e, summaryHash: 'deadbeef'.repeat(8) } : e,
    );
    expect(audit.detectTamper(tampered).ok).toBe(false);

    audit.redact(a.id);
    expect(audit.verify().ok).toBe(true);
    expect(audit.list().find((e) => e.id === a.id)?.eventData).toBeNull();
  });

  it('null policy herda EPID do ancestral', () => {
    const e = eng();
    e.grantPolicy('alice', 'finance');
    const root = e.addNode({
      id: 'root',
      resourceId: 'org',
      policy: 'finance',
      parentId: null,
    });
    const child = e.addNode({
      id: 'child',
      resourceId: 'leaf',
      policy: null,
      parentId: root.id,
    });
    expect(child.epid).toBeTruthy();
    expect(e.authorize({ principal: 'alice', resource: 'leaf', operation: 'read' }).decision).toBe(
      'allow',
    );
    expect(
      e.authorize({ principal: 'alice', resource: 'leaf', operation: 'modify' }).decision,
    ).toBe('partial');
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
