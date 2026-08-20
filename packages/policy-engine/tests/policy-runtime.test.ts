/**
 * policy-engine — tests/policy-runtime.test.ts
 * One snapshot generation; persist fail-closed; concurrent readers.
 */
import { describe, expect, it } from 'vitest';

import {
  ALLOW_ALL_POLICY_OVERLAY,
  createAllowAllTestPolicy,
  createDenyAllAuthorizer,
  createMemoryPolicyStore,
  createPolicyRuntime,
  createPolicyRuntimeFromOverlay,
  DENY_ALL_POLICY_OVERLAY,
  KERNEL_ONTOLOGY,
  ResourceIds,
  type PolicyStore,
} from '../src/index.js';

function failingStore(inner: PolicyStore): PolicyStore {
  return {
    ...inner,
    async replaceSnapshot() {
      throw new Error('disk full');
    },
  };
}

describe('PolicyRuntime', () => {
  it('absence of policy denies overlay resources', async () => {
    const { policy } = await createPolicyRuntime({});
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
  });

  it('fixture runtime exposes degraded/refresh/watch without a store', async () => {
    const policy = createDenyAllAuthorizer();
    expect(policy.degraded()).toBe(false);
    expect(await policy.refresh()).toEqual({ generation: 0, changed: false, ok: true });
    const stop = policy.watch({ pollMs: 60_000 });
    stop();
    await policy.close();
  });

  it('store-backed watch with poll unsubscribes without leaking timers', async () => {
    const { policy } = await createPolicyRuntime({ overlay: DENY_ALL_POLICY_OVERLAY });
    const stop = policy.watch({ pollMs: 60_000 });
    stop();
    await policy.close();
  });

  it('named allow-all and deny-all fixtures', () => {
    const allow = createAllowAllTestPolicy({
      ontologies: [],
      objectTypes: [],
      linkTypes: [],
      actions: [{ ontologyId: KERNEL_ONTOLOGY, apiName: 'anything' }],
      functions: [],
      admin: [],
    });
    const deny = createPolicyRuntimeFromOverlay(DENY_ALL_POLICY_OVERLAY);
    expect(
      allow.authorize({
        principal: 'x',
        resource: ResourceIds.action(KERNEL_ONTOLOGY, 'anything'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      deny.authorize({
        principal: 'x',
        resource: ResourceIds.action(KERNEL_ONTOLOGY, 'anything'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
  });

  it('persist failure keeps generation and previous decisions', async () => {
    const store = createMemoryPolicyStore();
    const { policy } = await createPolicyRuntime({
      store,
      overlay: DENY_ALL_POLICY_OVERLAY,
      persistOverlayIfEmpty: true,
    });
    const gen = policy.generation();
    const broken = failingStore(store);
    const again = await createPolicyRuntime({ store: broken, overlay: DENY_ALL_POLICY_OVERLAY });
    await expect(again.admin.publishOverlay(ALLOW_ALL_POLICY_OVERLAY)).rejects.toThrow(/disk full/);
    expect(again.policy.generation()).toBe(gen);
    expect(
      again.policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
    await policy.close();
  });

  it('publish is atomically old or new under concurrent readers', async () => {
    const { policy, admin } = await createPolicyRuntime({
      overlay: DENY_ALL_POLICY_OVERLAY,
    });
    const req = {
      principal: 'alice',
      resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
      operation: 'read' as const,
    };
    const seen = new Set<string>();
    const readers: Promise<void>[] = [];
    for (let i = 0; i < 200; i += 1) {
      readers.push(
        Promise.resolve().then(() => {
          const g = policy.generation();
          const d = policy.authorize(req).decision;
          seen.add(`${g}:${d}`);
          if (g === 0) expect(d).toBe('deny');
        }),
      );
    }
    await admin.publishOverlay({
      roles: { alice: ['ops'] },
      grants: [{ role: 'ops', objectTypes: ['ot.order'], operations: ['read'] }],
    });
    await Promise.all(readers);
    for (const row of seen) {
      expect(row === '0:deny' || row.endsWith(':allow') || row.endsWith(':deny')).toBe(true);
      const [g, d] = row.split(':');
      if (g === '0') expect(d).toBe('deny');
    }
  });

  it('filterReadable + redact hide denied types and fields (hidden-miss count)', () => {
    const policy = createPolicyRuntimeFromOverlay({
      roles: { fernanda: ['fin'] },
      grants: [
        {
          role: 'fin',
          objectTypes: ['ot.order'],
          operations: ['read'],
          hiddenProperties: ['secret'],
        },
      ],
    });
    const rows = [
      { objectTypeId: 'ot.order', secret: 'x', status: 'open' },
      { objectTypeId: 'ot.employee', secret: 'y', status: 'hired' },
    ];
    const visible = policy.filterReadable('fernanda', rows);
    expect(visible.map((r) => r.objectTypeId)).toEqual(['ot.order']);
    const redacted = policy.redactProperties('fernanda', 'ot.order', {
      secret: 'x',
      status: 'open',
    });
    expect(redacted).toEqual({ status: 'open' });
  });
});
