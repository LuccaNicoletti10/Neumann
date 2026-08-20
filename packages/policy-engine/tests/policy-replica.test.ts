/**
 * Publish CAS, replica refresh, identical catalog skip.
 */
import { describe, expect, it } from 'vitest';

import {
  createMemoryPolicyStore,
  createPolicyRuntime,
  DENY_ALL_POLICY_OVERLAY,
  KERNEL_ONTOLOGY,
  PolicyGenerationConflict,
  ResourceIds,
  type PolicyOverlay,
  type PolicyStore,
} from '../src/index.js';

const orderRead: PolicyOverlay = {
  roles: { alice: ['ops'] },
  grants: [{ role: 'ops', objectTypes: ['ot.order'], operations: ['read'] }],
};

const orderCatalog = {
  ontologies: [KERNEL_ONTOLOGY],
  objectTypes: [{ ontologyId: KERNEL_ONTOLOGY, id: 'ot.order' }],
  linkTypes: [],
  actions: [],
  functions: [],
  admin: [],
  approverPolicies: [],
};

describe('policy replica + CAS publish', () => {
  it('replica B observes revoke published on A without restart', async () => {
    const store = createMemoryPolicyStore();
    const a = await createPolicyRuntime({
      store,
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    const b = await createPolicyRuntime({ store });
    const req = {
      principal: 'alice',
      resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
      operation: 'read' as const,
    };
    expect(a.policy.authorize(req).decision).toBe('allow');
    expect((await b.policy.refresh()).ok).toBe(true);
    expect(b.policy.authorize(req).decision).toBe('allow');

    await a.admin.publishOverlay(DENY_ALL_POLICY_OVERLAY);
    const after = await b.policy.refresh();
    expect(after.ok).toBe(true);
    expect(after.generation).toBe(a.policy.generation());
    expect(b.policy.authorize(req).decision).toBe('deny');
    await a.policy.close();
    await b.policy.close();
  });

  it('two concurrent publishers: one CAS conflict; winner overlay remains', async () => {
    const inner = createMemoryPolicyStore();
    let snapshots = 0;
    let arm = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: PolicyStore = {
      ...inner,
      snapshot: async () => {
        const snap = await inner.snapshot();
        if (arm) {
          snapshots += 1;
          if (snapshots <= 2) await gate;
        }
        return snap;
      },
      replaceSnapshot: (next, expected) => inner.replaceSnapshot(next, expected),
    };
    const a = await createPolicyRuntime({
      store,
      overlay: DENY_ALL_POLICY_OVERLAY,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    const b = await createPolicyRuntime({ store });
    const overlayA: PolicyOverlay = {
      roles: { alice: ['a'] },
      grants: [{ role: 'a', objectTypes: ['ot.order'], operations: ['read'] }],
    };
    const overlayB: PolicyOverlay = {
      roles: { bob: ['b'] },
      grants: [{ role: 'b', objectTypes: ['ot.order'], operations: ['read'] }],
    };
    arm = true;
    const p1 = a.admin.publishOverlay(overlayA);
    const p2 = b.admin.publishOverlay(overlayB);
    release();
    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(PolicyGenerationConflict);
    await a.policy.refresh();
    await b.policy.refresh();
    const alice = a.policy.authorize({
      principal: 'alice',
      resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
      operation: 'read',
    }).decision;
    const bob = a.policy.authorize({
      principal: 'bob',
      resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
      operation: 'read',
    }).decision;
    expect(alice === 'allow' || bob === 'allow').toBe(true);
    expect(alice === 'allow' && bob === 'allow').toBe(false);
    await a.policy.close();
    await b.policy.close();
  });

  it('identical catalog on bootstrap / publish does not bump generation', async () => {
    const { policy, admin } = await createPolicyRuntime({
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    const gen = policy.generation();
    const again = await admin.publishCatalog(orderCatalog);
    expect(again.generation).toBe(gen);
    expect(policy.generation()).toBe(gen);
    policy.recompileCatalog(orderCatalog);
    expect(policy.generation()).toBe(gen);
    await policy.close();
  });

  it('failed refresh keeps the last generation and marks degraded', async () => {
    const inner = createMemoryPolicyStore();
    const { policy, admin } = await createPolicyRuntime({
      store: inner,
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    await admin.publishOverlay(orderRead);
    const gen = policy.generation();
    inner.snapshot = async () => {
      throw new Error('replica disconnected');
    };
    const result = await policy.refresh();
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.generation).toBe(gen);
    expect(policy.degraded()).toBe(true);
    expect(policy.generation()).toBe(gen);
    await policy.close();
  });
});
