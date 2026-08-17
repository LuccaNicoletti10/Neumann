/**
 * policy-engine — tests/pg-policy.integration.test.ts
 * Durable grants/nodes survive restart; concurrent grants; mem≡pg parity.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { createIdGenerator, tryOpenIsolatedPg } from 'object-platform';

import { createPolicyEngine } from '../src/core/engine.js';
import { createMemoryPolicyStore } from '../src/core/policy-store.js';
import { createPgPolicyStore } from '../src/core/pg-policy-store.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('PgPolicyStore durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('grant + node survive restart', async () => {
    if (!db) return;
    const nextId = createIdGenerator();
    const store = createPgPolicyStore({ sql: db.sql });
    const e = createPolicyEngine({ store, nextId });
    e.grantPolicy('alice', 'finance');
    e.addNode({ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null });
    await e.flush();
    expect(e.authorize({ principal: 'alice', resource: 'r1', operation: 'read' }).decision).toBe(
      'allow',
    );

    await db.sql.close();
    const sql2 = db.reconnect();
    const store2 = createPgPolicyStore({ sql: sql2 });
    const e2 = createPolicyEngine({ store: store2, nextId: createIdGenerator() });
    await e2.hydrate();
    expect(e2.authorize({ principal: 'alice', resource: 'r1', operation: 'read' }).decision).toBe(
      'allow',
    );
    await sql2.close();
  });

  it('concurrent grants do not lose rows', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const store = createPgPolicyStore({ sql });
    await Promise.all([
      store.grant('bob', 'ops'),
      store.grant('bob', 'ops'),
      store.grant('bob', 'finance'),
    ]);
    const grants = await store.getGrants('bob');
    expect(grants.has('ops')).toBe(true);
    expect(grants.has('finance')).toBe(true);
    await sql.close();
  });

  it('null-policy inheritance and partial match memory', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const mem = createPolicyEngine({
      store: createMemoryPolicyStore(),
      nextId: createIdGenerator(),
    });
    const pg = createPolicyEngine({
      store: createPgPolicyStore({ sql }),
      nextId: createIdGenerator(),
    });
    for (const e of [mem, pg]) {
      e.grantPolicy('alice', 'finance');
      e.addNode({ id: 'root', resourceId: 'org', policy: 'finance', parentId: null });
      e.addNode({ id: 'child', resourceId: 'leaf', policy: null, parentId: 'root' });
    }
    await pg.flush();
    await mem.flush();
    expect(mem.authorize({ principal: 'alice', resource: 'leaf', operation: 'read' }).decision).toBe(
      'allow',
    );
    expect(pg.authorize({ principal: 'alice', resource: 'leaf', operation: 'read' }).decision).toBe(
      'allow',
    );
    expect(
      mem.authorize({ principal: 'alice', resource: 'leaf', operation: 'modify' }).decision,
    ).toBe('partial');
    expect(pg.authorize({ principal: 'alice', resource: 'leaf', operation: 'modify' }).decision).toBe(
      'partial',
    );
    await sql.close();
  });

  it('epidsForPrincipal uses policy index (policy IN)', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const store = createPgPolicyStore({ sql });
    const e = createPolicyEngine({ store, nextId: createIdGenerator() });
    e.grantPolicy('alice', 'finance');
    e.addNode({ id: 'n-explain', resourceId: 'r-explain', policy: 'finance', parentId: null });
    await e.flush();
    const plan = await sql.query(
      `EXPLAIN SELECT epid FROM policy_epid_tuples WHERE policy = ANY($1::text[])`,
      [['finance']],
    );
    const text = (plan.rows as Array<Record<string, string>>).map((r) => Object.values(r)[0]).join('\n');
    expect(text.toLowerCase()).toMatch(/index|bitmap|policy_epid_tuples_policy/i);
    expect(e.epidsForPrincipal('alice').length).toBeGreaterThan(0);
    await sql.close();
  });
});
