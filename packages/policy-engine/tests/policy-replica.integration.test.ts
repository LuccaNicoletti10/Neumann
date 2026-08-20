/**
 * Two PolicyRuntime replicas on independent PostgreSQL connections.
 *
 * Production observation is LISTEN on `neumann_policy_generation` via
 * TransactionalSqlClient.listen (dedicated pool checkout). SqlClient fakes
 * without listen() poll every 100ms — that path is not used here.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { openIsolatedPg } from 'object-platform';

import {
  createPgPolicyStore,
  createPolicyRuntime,
  DENY_ALL_POLICY_OVERLAY,
  KERNEL_ONTOLOGY,
  PolicyGenerationConflict,
  ResourceIds,
  type PolicyOverlay,
  type PolicyStore,
} from '../src/index.js';

const db = await openIsolatedPg();

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

const orderReadReq = {
  principal: 'alice',
  resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
  operation: 'read' as const,
};

function listenOf(sql: object): unknown {
  return (sql as { listen?: unknown }).listen;
}

async function waitUntil(label: string, pred: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(label);
}

describe('PolicyRuntime PostgreSQL multi-replica', () => {
  afterAll(async () => {
    await db.close();
  });

  it('replica B observes A revoke via LISTEN without restart', async () => {
    const sqlA = db.reconnect();
    const sqlB = db.reconnect();
    expect(typeof listenOf(sqlA)).toBe('function');
    expect(typeof listenOf(sqlB)).toBe('function');
    const a = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sqlA }),
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    const b = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sqlB }),
    });
    expect(a.policy.authorize(orderReadReq).decision).toBe('allow');
    expect(b.policy.authorize(orderReadReq).decision).toBe('allow');

    await a.admin.publishOverlay(DENY_ALL_POLICY_OVERLAY);
    await waitUntil('replica B did not observe generation', async () => {
      return b.policy.generation() === a.policy.generation();
    });
    expect(b.policy.authorize(orderReadReq).decision).toBe('deny');
    expect(b.policy.degraded()).toBe(false);

    await a.policy.close();
    await b.policy.close();
    await sqlA.close();
    await sqlB.close();
  });

  it('killed replica B recovers the current generation on reopen', async () => {
    const sqlA = db.reconnect();
    const sqlB = db.reconnect();
    const a = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sqlA }),
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    const b = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sqlB }),
    });
    await a.admin.publishOverlay(DENY_ALL_POLICY_OVERLAY);
    await waitUntil('replica B did not observe revoke before kill', async () => {
      return b.policy.authorize(orderReadReq).decision === 'deny';
    });
    const generation = a.policy.generation();
    await b.policy.close();
    await sqlB.close();

    const sqlB2 = db.reconnect();
    const recovered = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sqlB2 }),
    });
    expect(recovered.policy.generation()).toBe(generation);
    expect(recovered.policy.authorize(orderReadReq).decision).toBe('deny');

    await a.policy.close();
    await recovered.policy.close();
    await sqlA.close();
    await sqlB2.close();
  });

  it('concurrent publishers: one commit and one generation conflict', async () => {
    const sqlA = db.reconnect();
    const sqlB = db.reconnect();
    let snapshots = 0;
    let arm = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    function wrap(inner: PolicyStore): PolicyStore {
      return {
        ...inner,
        snapshot: async () => {
          const snap = await inner.snapshot();
          if (arm) {
            snapshots += 1;
            if (snapshots <= 2) await gate;
          }
          return snap;
        },
      };
    }
    const a = await createPolicyRuntime({
      store: wrap(createPgPolicyStore({ sql: sqlA })),
      overlay: DENY_ALL_POLICY_OVERLAY,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    const b = await createPolicyRuntime({
      store: wrap(createPgPolicyStore({ sql: sqlB })),
    });
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
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PolicyGenerationConflict);

    await a.policy.refresh();
    await b.policy.refresh();
    const alice = a.policy.authorize(orderReadReq).decision;
    const bob = a.policy.authorize({
      principal: 'bob',
      resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
      operation: 'read',
    }).decision;
    expect(alice === 'allow' || bob === 'allow').toBe(true);
    expect(alice === 'allow' && bob === 'allow').toBe(false);

    await a.policy.close();
    await b.policy.close();
    await sqlA.close();
    await sqlB.close();
  });

  it('identical catalog on a second bootstrap does not bump generation', async () => {
    const sql1 = db.reconnect();
    const first = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sql1 }),
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    await first.admin.publishOverlay(orderRead);
    const gen = first.policy.generation();
    const again = await first.admin.publishCatalog(orderCatalog);
    expect(again.generation).toBe(gen);
    await first.policy.close();
    await sql1.close();

    const sql2 = db.reconnect();
    const second = await createPolicyRuntime({
      store: createPgPolicyStore({ sql: sql2 }),
      overlay: orderRead,
      catalog: orderCatalog,
      persistOverlayIfEmpty: true,
    });
    expect(second.policy.generation()).toBe(gen);
    expect(second.policy.authorize(orderReadReq).decision).toBe('allow');
    await second.policy.close();
    await sql2.close();
  });
});
