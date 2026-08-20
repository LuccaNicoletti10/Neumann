/**
 * policy-engine — tests/policy-runtime.integration.test.ts
 * Restart PG preserves overlay; memory ≡ PG decisions.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import {
  createPgPolicyStore,
  createPolicyRuntime,
  KERNEL_ONTOLOGY,
  ResourceIds,
  type PolicyOverlay,
} from '../src/index.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('PolicyRuntime PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('restart PG preserves overlay decisions', async () => {
    if (!db) return;
    const store = createPgPolicyStore({ sql: db.sql });
    const first = await createPolicyRuntime({
      store,
      overlay: {
        roles: { alice: ['ops'] },
        grants: [{ role: 'ops', objectTypes: ['ot.order'], operations: ['read', 'modify'] }],
      },
      persistOverlayIfEmpty: true,
    });
    expect(
      first.policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('allow');
    const generation = first.policy.generation();
    await first.policy.close();

    await db.sql.close();
    const sql2 = db.reconnect();
    const store2 = createPgPolicyStore({ sql: sql2 });
    const second = await createPolicyRuntime({ store: store2 });
    expect(second.policy.generation()).toBe(generation);
    expect(
      second.policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('allow');
    expect(
      second.policy.authorize({
        principal: 'eve',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
    await sql2.close();
  });

  it('memory and PG overlays have the same decisions', async () => {
    if (!db) return;
    const overlay: PolicyOverlay = {
      roles: { bob: ['ops'] },
      grants: [
        {
          role: 'ops',
          objectTypes: ['ot.order'],
          actions: ['approve'],
          operations: ['read', 'modify'],
          hiddenProperties: ['internal'],
        },
      ],
    };
    const mem = await createPolicyRuntime({ overlay });
    const sql = db.reconnect();
    const pg = await createPolicyRuntime({
      store: createPgPolicyStore({ sql }),
    });
    await pg.admin.publishOverlay(overlay);
    const reqs = [
      { principal: 'bob', resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'), operation: 'read' as const },
      { principal: 'bob', resource: ResourceIds.action(KERNEL_ONTOLOGY, 'approve'), operation: 'modify' as const },
      { principal: 'eve', resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'), operation: 'read' as const },
    ];
    for (const req of reqs) {
      expect(mem.policy.authorize(req).decision).toBe(pg.policy.authorize(req).decision);
    }
    expect(mem.policy.redactProperties('bob', 'ot.order', { internal: 1, n: 2 })).toEqual(
      pg.policy.redactProperties('bob', 'ot.order', { internal: 1, n: 2 }),
    );
    await sql.close();
  });
});
