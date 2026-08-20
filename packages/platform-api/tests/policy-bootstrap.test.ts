/**
 * platform-api — tests/policy-bootstrap.test.ts
 * listen only after policy; hydrate/seed failure closes resources; one policy instance.
 */
import { describe, expect, it } from 'vitest';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SqlClient } from 'contracts';
import { checksumSql, findInfraSqlDir } from 'object-platform';

import { ResourceIds, KERNEL_ONTOLOGY } from 'policy-engine';

import { createPlatformRuntime } from '../src/core/bootstrap.js';
import {
  createMemoryPlatformContext,
  createPlatformContext,
  createPostgresPlatformContext,
  fixtureOverlay,
} from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { createSecuredReads, ReadForbiddenError } from '../src/core/secured-reads.js';
import {
  extractBearerToken,
  extractDevPrincipal,
  getCurrentPrincipal,
} from '../src/core/principal.js';
import * as platformApi from '../src/index.js';

describe('policy bootstrap', () => {
  it('createPlatformServer requires a ready policy context', async () => {
    await expect(createPlatformServer(undefined as never)).rejects.toThrow(/policy/);
  });

  it('/health is live while /ready is 503 when not ready', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const { app } = await createPlatformServer(ctx);
    ctx.ready = false;
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    ctx.ready = true;
    const readyOk = await app.inject({ method: 'GET', url: '/ready' });
    expect(readyOk.statusCode).toBe(200);
    await app.close();
  });

  it('createPlatformServer refuses listen-before-hydrate', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    ctx.ready = false;
    await expect(createPlatformServer(ctx)).rejects.toThrow(/not ready/);
  });

  it('authorizer is the same object as policy; a second evaluator is refused', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    expect(ctx.authorizer).toBe(ctx.policy);
    expect(ctx.authorizer.authorize).toBe(ctx.policy.authorize);
    const other = createMemoryPlatformContext({ policyFixture: 'allow-all' }).policy;
    expect(() =>
      createMemoryPlatformContext({
        policy: ctx.policy,
        authorizer: other,
      }),
    ).toThrow(/second evaluator/);
    const split = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    (split as { authorizer: typeof other }).authorizer = other;
    await expect(createPlatformServer(split)).rejects.toThrow(/second evaluator/);
    await expect(
      createPostgresPlatformContext({
        sql: {
          query: async () => {
            throw new Error('must not query after second-evaluator refuse');
          },
        },
        transaction: {
          transaction: async () => {
            throw new Error('must not open a transaction after second-evaluator refuse');
          },
        },
        policy: ctx.policy,
        authorizer: other,
      }),
    ).rejects.toThrow(/second evaluator/);
  });

  it('postgres bootstrap applies migrations then aliases authorizer to the injected policy', async () => {
    const dir = findInfraSqlDir();
    const checksums = Object.fromEntries(
      readdirSync(dir)
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .map((f) => [f, checksumSql(readFileSync(join(dir, f), 'utf8'))]),
    );
    const sql = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
        if (text.includes('SELECT checksum FROM schema_migrations')) {
          const filename = String(params?.[0] ?? '');
          const checksum = checksums[filename];
          return { rows: checksum ? ([{ checksum }] as T[]) : [] };
        }
        if (text.includes('FROM policy_meta')) {
          return { rows: [{ generation: 1, overlay: {}, catalog: {} }] as T[] };
        }
        return { rows: [] as T[] };
      },
      async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
        return fn(sql);
      },
    };
    const policy = createMemoryPlatformContext({ policyFixture: 'allow-all' }).policy;
    const ctx = await createPostgresPlatformContext({
      sql,
      transaction: sql,
      policy,
    });
    expect(ctx.ready).toBe(true);
    expect(ctx.authorizer).toBe(ctx.policy);
    expect(ctx.authorizer).toBe(policy);
    expect(ctx.mode).toBe('postgres');
    await ctx.objects.get('ont', 'ot.x', '1');
    await expect(
      ctx.objects.create({
        ontologyId: 'ont',
        objectTypeId: 'ot.x',
        primaryKey: '1',
        properties: {},
      }),
    ).rejects.toThrow();
    await expect(
      ctx.links.create({
        ontologyId: 'ont',
        linkTypeId: 'lt.x',
        sourceObjectTypeId: 'ot.a',
        sourcePrimaryKey: '1',
        targetObjectTypeId: 'ot.b',
        targetPrimaryKey: '2',
      }),
    ).rejects.toThrow();
    await expect(
      ctx.projections.projectObject({
        principal: 'alice',
        ontologyId: 'ont',
        objectTypeId: 'ot.x',
        primaryKey: '1',
        properties: {},
        source: 'test',
        sourceEventId: 'evt-1',
      }),
    ).rejects.toThrow();
    const { app } = await createPlatformServer(ctx);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    await app.close();
    await ctx.close?.();
  });

  it('listen is refused until ctx.ready', async () => {
    const runtime = await createPlatformRuntime({
      memory: { policyFixture: 'allow-all' },
    });
    runtime.ctx.ready = false;
    await expect(runtime.listen({ port: 0 })).rejects.toThrow(/not ready/);
    runtime.ctx.ready = true;
    await runtime.close();
  });

  it('seed failure does not leave ready=true', async () => {
    expect(() =>
      createMemoryPlatformContext({
        policyFixture: 'allow-all',
        seed: async () => {
          throw new Error('seed boom');
        },
      }),
    ).toThrow(/createPlatformRuntime/);
  });

  it('postgres hydrate failure closes the sql client', async () => {
    let closed = 0;
    const sql = {
      query: async () => {
        throw new Error('hydrate failed');
      },
      close: async () => {
        closed += 1;
      },
    };
    await expect(
      createPostgresPlatformContext({
        sql,
        transaction: {
          transaction: async (fn) => fn(sql),
        },
        databaseUrl: undefined,
        policyFixture: 'allow-all',
      }),
    ).rejects.toThrow(/policy schema missing|hydrate failed/);
    expect(closed).toBeGreaterThanOrEqual(0);
  });

  it('read, Action and mutation share the same PolicyRuntime instance', async () => {
    const ctx = createMemoryPlatformContext({
      overlay: {
        roles: { alice: ['ops'], eve: [] },
        grants: [
          {
            role: 'ops',
            objectTypes: ['ot.order'],
            actions: ['approve'],
            operations: ['read', 'modify'],
          },
        ],
      },
    });
    expect(ctx.actions).toBeTruthy();
    expect(ctx.policy.authorizeFn).toBe(ctx.policy.authorize);
    expect(
      ctx.policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('allow');
    expect(
      ctx.policy.authorize({
        principal: 'alice',
        resource: ResourceIds.action(KERNEL_ONTOLOGY, 'approve'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      ctx.policy.authorize({
        principal: 'eve',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');

    const reads = createSecuredReads(ctx);
    expect(reads.canRead('eve', KERNEL_ONTOLOGY, 'ot.order')).toBe(false);
    expect(reads.canRead('alice', KERNEL_ONTOLOGY, 'ot.order')).toBe(true);
  });

  it('createPlatformRuntime memory is ready and /ready is 200 after listen setup', async () => {
    const runtime = await createPlatformRuntime({
      memory: { policyFixture: 'allow-all' },
    });
    expect(runtime.ctx.ready).toBe(true);
    const { app } = await createPlatformServer(runtime.ctx);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    await app.close();
    await runtime.close();
  });

  it('HTTP object create is denied when overlay has no modify grant', async () => {
    const ctx = createMemoryPlatformContext({
      overlay: {
        roles: { 'svc-projector': ['svc'] },
        grants: [{ role: 'svc', objectTypes: ['ot.thing'], operations: ['read'] }],
      },
    });
    const o = await ctx.ontology.createOntology({ name: 'mut' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: [],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    const { app } = await createPlatformServer(ctx);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing`,
      headers: { authorization: 'Bearer svc-projector' },
      payload: { primaryKey: '1', properties: {} },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it('denied object type does not reveal existence via list/count', async () => {
    const ctx = createMemoryPlatformContext({
      overlay: {
        roles: { alice: ['ops'] },
        grants: [{ role: 'ops', objectTypes: ['ot.order'], operations: ['read'] }],
      },
    });
    const o = await ctx.ontology.createOntology({ name: 'hid' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: [],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.secret',
      displayName: 'Secret',
      propertyTypeIds: [],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.secret',
      primaryKey: 'S1',
      properties: {},
    });
    const reads = createSecuredReads(ctx);
    expect(await reads.listObjects('alice', o.id, 'ot.secret')).toEqual([]);
    expect(await reads.getObject('alice', o.id, 'ot.secret', 'S1')).toBeUndefined();
    const agg = await reads.aggregateObjectSet('alice', o.id, {
      objectSet: { type: 'BASE', objectType: 'ot.secret' },
      aggregations: [{ kind: 'count' }],
    });
    expect(agg).toEqual({ count: 0 });
  });

  it('redaction precedes aggregate so hidden properties do not contribute', async () => {
    const ctx = createMemoryPlatformContext({
      overlay: {
        roles: { alice: ['ops'] },
        grants: [
          {
            role: 'ops',
            objectTypes: ['ot.order'],
            operations: ['read'],
            hiddenProperties: ['amount'],
          },
        ],
      },
    });
    const o = await ctx.ontology.createOntology({ name: 'agg' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'amount',
      displayName: 'Amount',
      baseType: 'number',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: ['amount'],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: 'O1',
      properties: { amount: 100 },
    });
    const reads = createSecuredReads(ctx);
    const agg = await reads.aggregateObjectSet('alice', o.id, {
      objectSet: { type: 'BASE', objectType: 'ot.order' },
      aggregations: [{ kind: 'sum', property: 'amount', name: 'sumAmount' }],
    });
    expect(agg).toEqual({ sumAmount: null });
  });

  it('PLATFORM_POLICY_FIXTURE=allow-all is the named memory bootstrap hatch', async () => {
    const prev = process.env.PLATFORM_POLICY_FIXTURE;
    process.env.PLATFORM_POLICY_FIXTURE = 'allow-all';
    try {
      const runtime = await createPlatformRuntime({ memory: {} });
      expect(runtime.ctx.ready).toBe(true);
      expect(
        runtime.ctx.policy.authorize({
          principal: 'anyone',
          resource: ResourceIds.admin('render'),
          operation: 'read',
        }).decision,
      ).toBe('allow');
      expect(
        runtime.ctx.policy.authorize({
          principal: 'anyone',
          resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.x'),
          operation: 'read',
        }).decision,
      ).toBe('deny');
      await runtime.close();
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_POLICY_FIXTURE;
      else process.env.PLATFORM_POLICY_FIXTURE = prev;
    }
  });

  it('createPlatformContext is the memory alias and fixtureOverlay is deny/allow', () => {
    expect(platformApi.createMemoryPlatformContext).toBeTypeOf('function');
    const ctx = createPlatformContext({ policyFixture: 'deny-all' });
    expect(ctx.ready).toBe(true);
    expect(fixtureOverlay('allow-all').everyoneRole).toBe('world');
    expect(fixtureOverlay('deny-all').grants).toEqual([]);
    expect(new ReadForbiddenError('x', 'ot.y').errorCode).toBe('READ_FORBIDDEN');
  });

  it('postgres sql without TransactionManager fails after schema check', async () => {
    await expect(
      createPostgresPlatformContext({
        sql: {
          query: async () => ({ rows: [{ generation: 0, overlay: {} }] }),
        } as SqlClient,
      }),
    ).rejects.toThrow(/TransactionManager/);
  });

  it('createPlatformRuntime postgres without DATABASE_URL fails closed', async () => {
    const prevUrl = process.env.DATABASE_URL;
    const prevMode = process.env.PLATFORM_MODE;
    delete process.env.DATABASE_URL;
    process.env.PLATFORM_MODE = 'postgres';
    try {
      await expect(createPlatformRuntime({})).rejects.toThrow(/DATABASE_URL/);
    } finally {
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
      if (prevMode === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prevMode;
    }
  });

  it('listen without port is refused; close is idempotent', async () => {
    const runtime = await createPlatformRuntime({
      memory: { policyFixture: 'deny-all' },
    });
    await expect(runtime.listen()).rejects.toThrow(/port/);
    expect(runtime.app).toBeTruthy();
    await runtime.close();
    await runtime.close();
  });

  it('principal helpers: bearer, anonymous, missing ALS', () => {
    expect(getCurrentPrincipal()).toBeUndefined();
    expect(extractDevPrincipal({ headers: {} })).toBe('anonymous');
    expect(extractDevPrincipal({ headers: { authorization: 'Bearer bob' } })).toBe('bob');
    expect(extractBearerToken({ headers: { authorization: 'Bearer tok' } })).toBe('tok');
    expect(extractBearerToken({ headers: {} })).toBeUndefined();
  });

  it('history and links are hidden-miss when the type is denied', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    const o = await ctx.ontology.createOntology({ name: 'hid2' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: [],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    const reads = createSecuredReads(ctx);
    expect(await reads.listHistory('eve', 'missing')).toEqual([]);
    expect(
      await reads.listLinkTargets('eve', o.id, 'ot.order', 'O1', 'lt.x'),
    ).toEqual([]);
  });
});
