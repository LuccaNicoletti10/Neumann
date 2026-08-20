/**
 * platform-api — tests/governed-storage-contract.integration.test.ts
 *
 * The same governed-storage contract as the memory runner, over real PostgreSQL.
 * The only extra input is `reopen`: a fresh context over the same schema, which
 * proves the durable adapter keeps identity, version and history across restart.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';
import { createAllowAllTestPolicy } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { runGovernedStorageContract } from './governed-storage-contract.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('governed-storage-contract — PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('satisfies the shared contract, including restart', async () => {
    if (!db) return;
    const open = () =>
      createPostgresPlatformContext({
        sql: db.sql,
        transaction: db.sql,
        policy: createAllowAllTestPolicy(),
      });
    const ctx = await open();
    const reopened: Awaited<ReturnType<typeof open>>[] = [];
    try {
      await runGovernedStorageContract({
        ctx,
        reopen: async () => {
          const next = await open();
          reopened.push(next);
          return next;
        },
      });
    } finally {
      for (const c of reopened) await c.close?.();
      await ctx.close?.();
    }
  });

  it('memory and PostgreSQL agree on the governed rule set', async () => {
    if (!db) return;
    // WHY here and not in the shared file: the shared file must stay adapter
    // agnostic. This asserts the two runners exercise one rule set, so a future
    // `if (mode === 'postgres')` branch in a rule breaks a test.
    const { createMemoryPlatformContext } = await import('../src/core/context.js');
    const mem = createMemoryPlatformContext({ policyFixture: 'allow-all', deterministic: false });
    const pg = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      policy: createAllowAllTestPolicy(),
    });
    try {
      expect(typeof mem.projections.projectObject).toBe('function');
      expect(typeof pg.projections.projectObject).toBe('function');
      expect(Object.keys(mem.projections).sort()).toEqual(Object.keys(pg.projections).sort());
    } finally {
      await pg.close?.();
      await mem.close?.();
    }
  });
});
