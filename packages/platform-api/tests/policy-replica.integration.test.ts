/**
 * Postgres PlatformContext: one policy authority, LISTEN replicas, /ready on refresh fail.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';
import { DENY_ALL_POLICY_OVERLAY } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

const db = await tryOpenIsolatedPg();

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

describe.skipIf(!db)('platform-api PostgreSQL policy replica', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('ctx.authorizer is ctx.policy after postgres bootstrap', async () => {
    const sql = db!.reconnect();
    expect(typeof listenOf(sql)).toBe('function');
    const ctx = await createPostgresPlatformContext({
      sql,
      transaction: sql,
      policyFixture: 'deny-all',
    });
    expect(ctx.ready).toBe(true);
    expect(ctx.authorizer).toBe(ctx.policy);
    expect(ctx.authorizer.authorize).toBe(ctx.policy.authorize);
    await ctx.close?.();
    await sql.close();
  });

  it('identical catalog on a second postgres bootstrap does not bump generation', async () => {
    const sql1 = db!.reconnect();
    const first = await createPostgresPlatformContext({
      sql: sql1,
      transaction: sql1,
      policyFixture: 'deny-all',
    });
    const gen = first.policy.generation();
    await first.close?.();
    await sql1.close();

    const sql2 = db!.reconnect();
    const second = await createPostgresPlatformContext({
      sql: sql2,
      transaction: sql2,
      policyFixture: 'deny-all',
    });
    expect(second.policy.generation()).toBe(gen);
    expect(second.authorizer).toBe(second.policy);
    await second.close?.();
    await sql2.close();
  });

  it('replica B changes generation after A publishes, without restart', async () => {
    const sqlA = db!.reconnect();
    const sqlB = db!.reconnect();
    const a = await createPostgresPlatformContext({
      sql: sqlA,
      transaction: sqlA,
      policyFixture: 'allow-all',
    });
    const b = await createPostgresPlatformContext({
      sql: sqlB,
      transaction: sqlB,
    });
    expect(a.authorizer).toBe(a.policy);
    expect(b.authorizer).toBe(b.policy);
    const before = b.policy.generation();
    if (!a.policyAdmin) throw new Error('postgres context must expose policyAdmin');
    await a.policyAdmin.publishOverlay(DENY_ALL_POLICY_OVERLAY);
    await waitUntil('platform replica B did not observe generation', async () => {
      return b.policy.generation() !== before;
    });
    expect(b.policy.generation()).toBe(a.policy.generation());
    expect(b.policy.degraded()).toBe(false);
    await a.close?.();
    await b.close?.();
    await sqlA.close();
    await sqlB.close();
  });

  it('refresh failure keeps last generation and /ready is 503', async () => {
    const sql = db!.reconnect();
    const ctx = await createPostgresPlatformContext({
      sql,
      transaction: sql,
      policyFixture: 'allow-all',
    });
    const gen = ctx.policy.generation();
    const { app } = await createPlatformServer(ctx);
    const readyOk = await app.inject({ method: 'GET', url: '/ready' });
    expect(readyOk.statusCode).toBe(200);

    await sql.close();
    const refresh = await ctx.policy.refresh();
    expect(refresh.ok).toBe(false);
    expect(refresh.generation).toBe(gen);
    expect(ctx.policy.degraded()).toBe(true);
    expect(ctx.policy.generation()).toBe(gen);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    await app.close();
    await ctx.close?.();
  });
});
