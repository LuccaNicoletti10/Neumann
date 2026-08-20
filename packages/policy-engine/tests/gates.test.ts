/**
 * policy-engine — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createDeterministicSalt,
  createIdGenerator,
} from '../src/core/determinism.js';
import { createAuditLog, createDecisionLogSink } from '../src/core/audit.js';
import { createPolicyEngine } from '../src/core/engine.js';
import {
  createAllowAllTestPolicy,
  createDenyAllAuthorizer,
  createOntologyAuthorizer,
} from '../src/core/ontology-authorizer.js';
import { KERNEL_ONTOLOGY, ResourceIds } from '../src/core/resource-ids.js';
import { runClassifyDemo, runDemo, runNoninterferenceDemo, runRedactDemo } from '../src/cli.js';

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
    expect(view.count).toBe(0);
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

  it('audit hash chain detecta adulteração e sobrevive redact', async () => {
    const audit = createAuditLog({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      nextSalt: createDeterministicSalt(),
    });
    await audit.begin();
    const a = await audit.append('event-a', { k: '1' });
    await audit.append('event-b', { k: '2' });
    expect((await audit.verify()).ok).toBe(true);

    const tampered = (await audit.list()).map((e) =>
      e.id === a.id ? { ...e, summaryHash: 'deadbeef'.repeat(8) } : e,
    );
    expect(audit.detectTamper(tampered).ok).toBe(false);

    await audit.redact(a.id);
    expect((await audit.verify()).ok).toBe(true);
    expect((await audit.list()).find((e) => e.id === a.id)?.eventData).toBeNull();
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

  it('cli demo exit 0', async () => {
    const lines: string[] = [];
    expect(await runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });

  it('OntologyAuthorizer is one source for read/action/explain', () => {
    const authz = createOntologyAuthorizer({
      roles: { alice: ['ops'] },
      grants: [
        {
          role: 'ops',
          objectTypes: ['ot.order'],
          actions: ['approve'],
          operations: ['read', 'modify'],
        },
      ],
    });
    expect(authz.authorizeRead('alice', 'ot.order').decision).toBe('allow');
    expect(authz.authorizeMutation('alice', 'ot.order').decision).toBe('allow');
    expect(authz.authorizeAction('alice', 'approve').decision).toBe('allow');
    expect(authz.authorizeAction('alice', 'deleteAll').decision).toBe('deny');
    expect(
      authz.explainDecision({
        principal: 'alice',
        resource: ResourceIds.action(KERNEL_ONTOLOGY, 'approve'),
        operation: 'modify',
      }).reason,
    ).toMatch(/grant/);
    expect(
      createAllowAllTestPolicy({
        ontologies: [],
        objectTypes: [],
        linkTypes: [],
        actions: [{ ontologyId: KERNEL_ONTOLOGY, apiName: 'x' }],
        functions: [],
        admin: [],
      }).authorizeAction('anyone', 'x').decision,
    ).toBe('allow');
    expect(createDenyAllAuthorizer().authorizeRead('eve', 'ot.order').decision).toBe('deny');
  });

  it('Passo 26: classification gate deny when marking exceeds principal max', () => {
    const authz = createOntologyAuthorizer(
      {
        roles: { bob: ['ops'] },
        grants: [{ role: 'ops', objectTypes: ['*'], operations: ['read'] }],
        maxClassification: { bob: 'Unclassified' },
      },
      {
        catalog: {
          ontologies: [KERNEL_ONTOLOGY],
          objectTypes: [
            { ontologyId: KERNEL_ONTOLOGY, id: 'ot.customer' },
            { ontologyId: KERNEL_ONTOLOGY, id: 'ot.order' },
          ],
          linkTypes: [],
          actions: [],
          functions: [],
          admin: [],
        },
      },
    );
    expect(
      authz.authorize({
        principal: 'bob',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.customer'),
        operation: 'read',
        context: { classification: 'Confidential' },
      }).decision,
    ).toBe('deny');
    expect(
      authz.filterReadable('bob', [
        { objectTypeId: 'ot.customer', classification: 'Confidential' },
        { objectTypeId: 'ot.order', classification: 'Unclassified' },
      ]).map((r) => r.objectTypeId),
    ).toEqual(['ot.order']);
  });

  it('Passo 26 classify demo exit 0', async () => {
    const lines: string[] = [];
    expect(await runClassifyDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('classify ok'))).toBe(true);
  });

  it('Passo 27 redact demo: no leak, no dangling edges', () => {
    const lines: string[] = [];
    expect(runRedactDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('redact ok'))).toBe(true);
  });

  it('Passo 28 ni demo: 8 canais + fuzz sem violação', () => {
    const lines: string[] = [];
    expect(runNoninterferenceDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('ni ok'))).toBe(true);
  });

  it('P1-6: deny is always logged; allow is sampled deterministically', () => {
    const denies: string[] = [];
    const allows: string[] = [];
    const e = createPolicyEngine({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      allowSampleRate: 0.1,
      sampleSeed: 'test-seed',
      onDecision: (d) => {
        if (d.decision === 'deny') denies.push(d.resource);
        if (d.decision === 'allow') allows.push(d.resource);
      },
    });
    e.grantPolicy('alice', 'finance');
    e.addNode({ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null });
    for (let i = 0; i < 50; i += 1) {
      e.addNode({ id: `secret-${i}`, resourceId: `secret-${i}`, policy: 'ops', parentId: null });
      e.authorize({ principal: 'alice', resource: `secret-${i}`, operation: 'read' });
    }
    expect(denies).toHaveLength(50);
    e.authorize({ principal: 'alice', resource: 'r1', operation: 'read' });
    const again = createPolicyEngine({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      allowSampleRate: 0.1,
      sampleSeed: 'test-seed',
      onDecision: (d) => {
        if (d.decision === 'allow') allows.push(`b:${d.resource}`);
      },
    });
    again.grantPolicy('alice', 'finance');
    again.addNode({ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null });
    again.authorize({ principal: 'alice', resource: 'r1', operation: 'read' });
    const firstAllow = allows.filter((a) => a === 'r1').length;
    const secondAllow = allows.filter((a) => a === 'b:r1').length;
    expect(firstAllow).toBe(secondAllow);
  });

  it('P1-6: 10k decides do not block on async append', async () => {
    const audit = createAuditLog({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
    });
    const sink = createDecisionLogSink(audit);
    const e = createPolicyEngine({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      allowSampleRate: 1,
      onDecision: sink.onDecision,
    });
    e.grantPolicy('alice', 'finance');
    e.addNode({ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null });
    const t0 = Date.now();
    for (let i = 0; i < 10_000; i += 1) {
      e.authorize({ principal: 'alice', resource: 'r1', operation: 'read' });
    }
    const syncMs = Date.now() - t0;
    expect(syncMs).toBeLessThan(2_000);
    await sink.drain();
    const listed = await audit.list();
    expect(listed.length).toBeGreaterThan(1);
  });
});
