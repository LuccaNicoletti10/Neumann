/**
 * policy-engine — tests/policy-overlay.test.ts
 * Overlay evaluation, resource IDs, store replaceSnapshot.
 */
import { describe, expect, it } from 'vitest';

import type { SqlClient } from 'contracts';

import {
  cloneOverlay,
  createAuditLog,
  createDecisionLogSink,
  createMemoryPolicyStore,
  createPgPolicyStore,
  createPolicyRuntime,
  EMPTY_POLICY_OVERLAY,
  emptyCatalog,
  KERNEL_ONTOLOGY,
  overlayFilterReadable,
  overlayRedactProperties,
  parsePolicyOverlay,
  parseResourceId,
  RESOURCE_SCHEME,
  ResourceIds,
  type PolicyOverlay,
} from '../src/index.js';

describe('ResourceIds', () => {
  it('builds and parses namespaced schemes; unknown is null', () => {
    expect(ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order')).toBe(
      `${RESOURCE_SCHEME.object}${KERNEL_ONTOLOGY}/ot.order`,
    );
    expect(ResourceIds.action('o1', 'approve')).toBe(`${RESOURCE_SCHEME.action}o1/approve`);
    expect(ResourceIds.actionExecution('e1')).toBe(`${RESOURCE_SCHEME.actionExecution}e1`);
    expect(ResourceIds.linkType(KERNEL_ONTOLOGY, 'lt.x')).toBe(
      `${RESOURCE_SCHEME.link}${KERNEL_ONTOLOGY}/lt.x`,
    );
    expect(ResourceIds.admin('publish')).toBe(`${RESOURCE_SCHEME.admin}publish`);
    expect(parseResourceId(ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'))).toEqual({
      scheme: RESOURCE_SCHEME.object,
      ontologyId: KERNEL_ONTOLOGY,
      localId: 'ot.order',
      resource: `${RESOURCE_SCHEME.object}${KERNEL_ONTOLOGY}/ot.order`,
    });
    expect(parseResourceId(ResourceIds.actionExecution('e1'))).toEqual({
      scheme: RESOURCE_SCHEME.actionExecution,
      ontologyId: KERNEL_ONTOLOGY,
      localId: 'e1',
      resource: `${RESOURCE_SCHEME.actionExecution}e1`,
    });
    expect(parseResourceId('object:ot.order')).toEqual({
      scheme: RESOURCE_SCHEME.object,
      ontologyId: KERNEL_ONTOLOGY,
      localId: 'ot.order',
      resource: 'object:ot.order',
    });
    expect(parseResourceId('dataset:foo')).toBeNull();
  });
});

describe('parsePolicyOverlay', () => {
  it('empty JSON and {} are deny-all, never allow-all', () => {
    expect(parsePolicyOverlay(null).grants).toEqual([]);
    expect(parsePolicyOverlay('{}').grants).toEqual([]);
    expect(parsePolicyOverlay({})).toEqual(EMPTY_POLICY_OVERLAY);
    const fromJson = parsePolicyOverlay(
      '{"roles":{"a":["ops"]},"grants":[{"role":"ops","objectTypes":["ot.order"]}]}',
    );
    expect(fromJson.roles.a).toEqual(['ops']);
  });

  it('rejects invalid JSON and invalid shape', () => {
    expect(() => parsePolicyOverlay('{')).toThrow(/invalid/);
    expect(() => parsePolicyOverlay({ grants: [] })).toThrow(/shape/);
  });

  it('clones overlay without sharing grant arrays', () => {
    const src = parsePolicyOverlay({
      roles: { a: ['ops'] },
      grants: [{ role: 'ops', objectTypes: ['ot.order'] }],
    });
    const copy = cloneOverlay(src);
    copy.grants[0]!.objectTypes?.push('ot.other');
    expect(src.grants[0]?.objectTypes).toEqual(['ot.order']);
  });
});

describe('redact and filter', () => {
  const overlay: PolicyOverlay = {
    roles: { alice: ['ops'] },
    grants: [
      {
        role: 'ops',
        objectTypes: ['ot.order'],
        operations: ['read'],
        hiddenProperties: ['secret'],
      },
    ],
    maxClassification: { alice: 'Unclassified' },
  };

  it('redacts hidden fields and filters unread + over-classified rows', () => {
    expect(overlayRedactProperties(overlay, 'alice', 'ot.order', { secret: 1, n: 2 })).toEqual({ n: 2 });
    const rows = overlayFilterReadable(overlay, 'alice', [
      { objectTypeId: 'ot.order' },
      { objectTypeId: 'ot.secret' },
      { objectTypeId: 'ot.order', classification: 'Confidential' },
      { objectTypeId: 'ot.order', classification: 'Unclassified' },
    ]);
    expect(rows.map((r) => r.classification ?? 'none')).toEqual(['none', 'Unclassified']);
  });
});

describe('memory PolicyStore.replaceSnapshot', () => {
  it('bumps generation once and replaces overlay atomically', async () => {
    const store = createMemoryPolicyStore();
    const g0 = await store.getGeneration();
    const g1 = await store.replaceSnapshot({
      grants: [{ principal: 'a', policy: 'ops' }],
      nodes: [],
      epids: [],
      overlay: {
        roles: { a: ['ops'] },
        grants: [{ role: 'ops', objectTypes: ['*'], operations: ['read'] }],
      },
      catalog: emptyCatalog(),
    });
    expect(g1).toBe(g0 + 1);
    const snap = await store.snapshot();
    expect(snap.overlay.roles.a).toEqual(['ops']);
    expect(snap.grants).toEqual([{ principal: 'a', policy: 'ops' }]);
  });
});

describe('PolicyAdmin publish success', () => {
  it('increments generation and switches decisions', async () => {
    const { policy, admin } = await createPolicyRuntime({ overlay: EMPTY_POLICY_OVERLAY });
    const before = policy.generation();
    await admin.publishCatalog({
      ontologies: [KERNEL_ONTOLOGY],
      objectTypes: [{ ontologyId: KERNEL_ONTOLOGY, id: 'ot.order' }],
      linkTypes: [],
      actions: [],
      functions: [],
      admin: [],
    });
    await admin.publishOverlay({
      everyoneRole: 'world',
      roles: {},
      grants: [{ role: 'world', objectTypes: ['*'], operations: ['read'] }],
    });
    expect(policy.generation()).toBeGreaterThan(before);
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('allow');
    await policy.close();
  });

  it('EPID nodes in the same snapshot authorize native resources', async () => {
    const store = createMemoryPolicyStore();
    await store.replaceSnapshot({
      grants: [{ principal: 'alice', policy: 'finance' }],
      nodes: [{ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null, epid: 'e1' }],
      epids: [{ epid: 'e1', policy: 'finance', parentId: null }],
      overlay: EMPTY_POLICY_OVERLAY,
      catalog: emptyCatalog(),
    });
    const { policy } = await createPolicyRuntime({ store });
    expect(
      policy.authorize({ principal: 'alice', resource: 'r1', operation: 'read' }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({ principal: 'eve', resource: 'r1', operation: 'read' }).decision,
    ).toBe('deny');
    await policy.close();
  });

  it('compat helpers and persistOverlayIfEmpty share authorizeFn', async () => {
    const store = createMemoryPolicyStore();
    const { policy } = await createPolicyRuntime({
      store,
      overlay: {
        roles: { alice: ['ops'] },
        grants: [
          {
            role: 'ops',
            objectTypes: ['ot.order'],
            actions: ['approve'],
            operations: ['read', 'modify'],
          },
        ],
      },
      persistOverlayIfEmpty: true,
    });
    expect(policy.authorizeFn).toBe(policy.authorize);
    expect(policy.authorizeRead('alice', 'ot.order').decision).toBe('allow');
    expect(policy.authorizeMutation('alice', 'ot.order').decision).toBe('allow');
    expect(policy.authorizeAction('alice', 'approve').decision).toBe('allow');
    expect(policy.explain({ principal: 'eve', resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'), operation: 'read' }).decision).toBe('deny');
    expect(policy.explainDecision({ principal: 'alice', resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'), operation: 'read' }).decision).toBe('allow');
    expect(policy.canReadObjectType('alice', 'ot.order')).toBe(true);
    expect(policy.canRunAction('eve', 'approve')).toBe(false);
    expect(await store.getGeneration()).toBeGreaterThan(0);
    await policy.close();
  });

  it('snapshot parent cycle is fail-closed', async () => {
    const store = createMemoryPolicyStore();
    await store.replaceSnapshot({
      grants: [],
      nodes: [
        { id: 'a', resourceId: 'r1', policy: 'p', parentId: 'b', epid: 'e1' },
        { id: 'b', resourceId: 'r2', policy: 'p', parentId: 'a', epid: 'e2' },
      ],
      epids: [],
      overlay: EMPTY_POLICY_OVERLAY,
      catalog: emptyCatalog(),
    });
    await expect(createPolicyRuntime({ store })).rejects.toThrow(/cycle/);
  });
});

describe('createPgPolicyStore replaceSnapshot (unit, no database)', () => {
  it('fails closed without a TransactionManager', async () => {
    const sql = { query: async () => ({ rows: [] }) } as SqlClient;
    const store = createPgPolicyStore({ sql });
    await expect(
      store.replaceSnapshot({
        grants: [],
        nodes: [],
        epids: [],
        overlay: EMPTY_POLICY_OVERLAY,
        catalog: emptyCatalog(),
      }),
    ).rejects.toThrow(/TransactionManager/);
  });

  it('rolls back in-memory when the transactional write detects a cycle', async () => {
    const sql = {
      query: async (text: string) => {
        if (text.includes('UPDATE policy_meta')) return { rows: [{ generation: 2 }] };
        return { rows: [] };
      },
    } as SqlClient;
    const store = createPgPolicyStore({
      sql,
      transaction: {
        async transaction(fn) {
          return fn(sql);
        },
      },
    });
    await expect(
      store.replaceSnapshot({
        grants: [],
        nodes: [
          { id: 'a', resourceId: 'r1', policy: 'p', parentId: 'b', epid: 'e1' },
          { id: 'b', resourceId: 'r2', policy: 'p', parentId: 'a', epid: 'e2' },
        ],
        epids: [],
        overlay: EMPTY_POLICY_OVERLAY,
        catalog: emptyCatalog(),
      }),
    ).rejects.toThrow(/cycle/);
  });
});

describe('createDecisionLogSink', () => {
  it('drain rethrows append failure instead of swallowing', async () => {
    const sink = createDecisionLogSink({
      append: async () => {
        throw new Error('audit disk full');
      },
    } as never);
    sink.onDecision({
      principal: 'a',
      resource: 'r',
      operation: 'read',
      decision: 'deny',
      reason: 'x',
      at: 't',
      principalEpids: [],
      resourceEpid: null,
    });
    await expect(sink.drain()).rejects.toThrow(/audit disk full/);
  });

  it('happy path still drains after memory append', async () => {
    const audit = createAuditLog();
    const sink = createDecisionLogSink(audit);
    sink.onDecision({
      principal: 'a',
      resource: 'r',
      operation: 'read',
      decision: 'deny',
      reason: 'x',
      at: 't',
      principalEpids: [],
      resourceEpid: null,
    });
    await sink.drain();
  });
});
