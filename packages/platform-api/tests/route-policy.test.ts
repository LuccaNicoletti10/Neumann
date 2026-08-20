/**
 * Every Fastify business route declares policy; ResourceIds only; deny before handler.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createMemoryPlatformContext,
} from '../src/core/context.js';
import {
  assertRoutePolicyClosure,
  declarePolicy,
  declarePublicRoute,
  listCollectedRoutes,
  PolicyDeniedError,
  POLICY_OPERATIONS,
  PUBLIC_ROUTE_PATHS,
  resetCollectedRoutes,
} from '../src/core/route-policy.js';
import { wrapOntologyWithPolicyCatalog, syncPolicyCatalog } from '../src/core/ontology-policy-sync.js';
import { createPlatformServer } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const ops = new Set<string>(POLICY_OPERATIONS);

function isPublic(method: string, url: string): boolean {
  if (method === 'OPTIONS') return true;
  return (method === 'GET' || method === 'HEAD') && PUBLIC_ROUTE_PATHS.has(url);
}

describe('route policy closure', () => {
  it('enumerates Fastify routes: business routes declare policy; public exceptions only', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const { app } = await createPlatformServer(ctx);
    const routes = listCollectedRoutes(app);
    expect(routes.length).toBeGreaterThan(0);
    const business = routes.filter((r) => !isPublic(r.method, r.url));
    expect(business.length).toBeGreaterThan(0);
    for (const r of business) {
      expect(r.policy, `${r.method} ${r.url}`).toBeTruthy();
      if (r.policy && 'hmacIngress' in r.policy && r.policy.hmacIngress) {
        expect(r.method).toBe('POST');
        expect(r.url).toContain('/ingest/');
        continue;
      }
      if (!r.policy || !('operation' in r.policy)) {
        throw new Error(`unclassified business route: ${r.method} ${r.url}`);
      }
      expect(ops.has(r.policy.operation), `${r.method} ${r.url} op=${r.policy.operation}`).toBe(
        true,
      );
      expect(typeof r.policy.resourceResolver).toBe('function');
    }
    expect(assertRoutePolicyClosure(routes)).toBeUndefined();
    await app.close();
  });

  it('route sources use ResourceIds and never concatenate overlay schemes', () => {
    const roots = [
      join(here, '../src/routes/v2.ts'),
      join(here, '../src/routes/er.ts'),
      join(here, '../src/routes/functions.ts'),
      join(here, '../src/routes/ingest.ts'),
    ];
    for (const file of roots) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/['"`]object:\$\{/);
      expect(src, file).not.toMatch(/['"`]action:\$\{/);
      expect(src, file).not.toMatch(/['"`]link:\$\{/);
      expect(src, file).not.toMatch(/['"`]admin:\$\{/);
      expect(src, file).not.toMatch(/['"`]ontology:\$\{/);
      expect(src, file).not.toMatch(/['"`]function:\$\{/);
    }
  });

  it('deny happens before the handler and preserves hidden-miss', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    const { app } = await createPlatformServer(ctx);
    const list = await app.inject({ method: 'GET', url: '/api/v2/ontologies' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ data: [] });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v2/ontologies',
      payload: { name: 'x' },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().errorCode).toBe('POLICY_DENIED');
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    await app.close();
  });

  it('boot fails on unclassified or unknown operation', () => {
    resetCollectedRoutes();
    expect(() =>
      assertRoutePolicyClosure([{ method: 'GET', url: '/api/v2/secret', policy: undefined }]),
    ).toThrow(/unclassified/);
    expect(() =>
      assertRoutePolicyClosure([
        {
          method: 'POST',
          url: '/api/v2/x',
          policy: { operation: 'explode' as never, resourceResolver: () => 'r' },
        },
      ]),
    ).toThrow(/unknown policy operation/);
    expect(declarePublicRoute().config.policy).toEqual({ public: true });
    expect(declarePolicy('read', () => 'admin:render').config.policy.operation).toBe('read');
    const err = new PolicyDeniedError('no');
    expect(err.statusCode).toBe(403);
    expect(err.errorCode).toBe('POLICY_DENIED');
    expect(() =>
      assertRoutePolicyClosure([
        { method: 'POST', url: '/api/v2/ontologies', policy: { public: true } },
      ]),
    ).toThrow(/declarePublicRoute is not allowed/);
    expect(() =>
      assertRoutePolicyClosure([
        {
          method: 'HEAD',
          url: '/api/v2/ontologies',
          policy: { operation: 'read', resourceResolver: () => 'admin:ontology.list' },
        },
      ]),
    ).not.toThrow();
  });

  it('ontology wrap republishes catalog after commit and rollback', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const syncs: number[] = [];
    const wrapped = wrapOntologyWithPolicyCatalog(ctx.ontology, async () => {
      syncs.push(1);
      await syncPolicyCatalog(ctx.ontology, ctx.policy);
    });
    const o = await wrapped.createOntology({ name: 'sync' });
    await wrapped.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'string' });
    await wrapped.addObjectType(o.id, { id: 'ot.x', displayName: 'X', propertyTypeIds: ['n'] });
    await wrapped.addLinkType(o.id, {
      id: 'lt.x',
      displayName: 'X',
      sourceObjectTypeId: 'ot.x',
      targetObjectTypeId: 'ot.x',
      cardinality: '1:1',
    });
    await wrapped.addActionType(o.id, {
      id: 'act.x',
      apiName: 'doX',
      displayName: 'Do',
      inputObjectTypeIds: ['ot.x'],
    });
    await wrapped.addFunctionType(o.id, {
      id: 'fn.x',
      apiName: 'fnX',
      displayName: 'Fn',
      inputObjectTypeIds: ['ot.x'],
    });
    const committed = await wrapped.commit({ ontologyId: o.id, createdBy: 't' });
    expect((await wrapped.getOntology(o.id))?.id).toBe(o.id);
    expect((await wrapped.listOntologies()).length).toBeGreaterThan(0);
    await wrapped.openDraft(o.id);
    expect(await wrapped.getDraft(o.id)).toBeTruthy();
    const v = await wrapped.getLatestVersion(o.id);
    expect(v).toBeTruthy();
    if (v) {
      expect(await wrapped.getVersion(v.id)).toBeTruthy();
      expect(await wrapped.listVersions(o.id)).toHaveLength(1);
      await wrapped.diff(v.id, v.id);
    }
    await wrapped.rollback(o.id, committed.id, 't');
    expect(syncs.length).toBeGreaterThanOrEqual(3);
  });
});
