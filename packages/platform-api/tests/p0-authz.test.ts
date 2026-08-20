/**
 * P0 authz: HTTP matrix, HEAD, render/catalog/Functions redaction, catalog counts.
 */
import { describe, expect, it } from 'vitest';

import type { AuthzDecision, AuthorizeFn, AuthorizeResult } from 'contracts';
import { AGGREGATE_METRICS_SOURCE, artifactBytesFromSource } from 'function-registry';
import { createDenyAllAuthorizer, createOntologyAuthorizer, type PolicyRuntime } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { signDevToken } from '../src/core/token-verifier.js';
import { createPlatformServer } from '../src/server.js';

const SECRET = 'test-hmac-secret-neumann';

function decision(d: AuthzDecision): AuthorizeResult {
  return {
    decision: d,
    principalEpids: d === 'deny' ? [] : ['e'],
    resourceEpid: d === 'deny' ? null : 'e',
    reason: d,
  };
}

function runtimeWith(authorize: AuthorizeFn): PolicyRuntime {
  const base = createDenyAllAuthorizer();
  return { ...base, authorize, authorizeFn: authorize };
}

describe('P0 HTTP authorization', () => {
  it('HTTP mutation matrix deny|partial|allow — partial writes zero ontologies', async () => {
    for (const d of ['deny', 'partial', 'allow'] as const) {
      const ctx = createMemoryPlatformContext({
        policy: runtimeWith(() => decision(d)),
      });
      const before = (await ctx.ontology.listOntologies()).length;
      const { app } = await createPlatformServer(ctx);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v2/ontologies',
        payload: { name: `n-${d}` },
      });
      const after = (await ctx.ontology.listOntologies()).length;
      if (d === 'allow') {
        expect(res.statusCode).toBe(201);
        expect(after).toBe(before + 1);
      } else {
        expect(res.statusCode).toBe(403);
        expect(after).toBe(before);
      }
      await app.close();
    }
  });

  it('Functions execute matrix: deny|partial write nothing; allow redacts refs', async () => {
    for (const d of ['deny', 'partial', 'allow'] as const) {
      const ctx = createMemoryPlatformContext({
        policy:
          d === 'allow'
            ? createOntologyAuthorizer({
                everyoneRole: 'world',
                roles: {},
                grants: [
                  {
                    role: 'world',
                    ontologyIds: ['*'],
                    objectTypes: ['ot.customer'],
                    functions: ['*'],
                    operations: ['read', 'modify'],
                    hiddenProperties: ['ssn'],
                  },
                ],
              })
            : runtimeWith(() => decision(d)),
      });
      const o = await ctx.ontology.createOntology({ name: 'fn' });
      for (const [id, baseType] of [
        ['name', 'string'],
        ['amount', 'number'],
        ['ssn', 'string'],
      ] as const) {
        await ctx.ontology.addPropertyType(o.id, { id, displayName: id, baseType });
      }
      await ctx.ontology.addObjectType(o.id, {
        id: 'ot.customer',
        displayName: 'Customer',
        propertyTypeIds: ['name', 'amount', 'ssn'],
      });
      if (d === 'allow') {
        const published = await ctx.functionArtifacts.publish(
          artifactBytesFromSource(AGGREGATE_METRICS_SOURCE),
          'test',
        );
        await ctx.ontology.addFunctionType(o.id, {
          id: 'fn.aggregateMetrics',
          apiName: 'aggregateMetrics',
          displayName: 'aggregateMetrics',
          inputObjectTypeIds: ['ot.customer'],
          artifactHash: published.artifactHash,
          functionVersion: 1,
        });
      }
      await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
      await ctx.objects.create({
        ontologyId: o.id,
        objectTypeId: 'ot.customer',
        primaryKey: 'A',
        properties: { name: 'ACME', amount: 80, ssn: '000-00-0000' },
      });
      const { app } = await createPlatformServer(ctx);
      const exec = await app.inject({
        method: 'POST',
        url: `/api/v2/ontologies/${o.id}/functions/aggregateMetrics/execute`,
        payload: {
          refs: [{ objectTypeId: 'ot.customer', primaryKey: 'A' }],
          params: { property: 'amount' },
        },
      });
      if (d === 'allow') {
        expect(exec.statusCode).toBe(202);
        expect(await ctx.functionWorker.drainOnce()).toBe(1);
        const done = await ctx.functions.get(exec.json().executionId, 'anonymous');
        expect(done?.status).toBe('SUCCEEDED');
        expect(JSON.stringify(done)).not.toContain('000-00-0000');
        expect(done?.objectSnapshot[0]?.properties).not.toHaveProperty('ssn');
      } else {
        expect(exec.statusCode).toBe(403);
      }
      await app.close();
    }
  });

  it('HEAD on a protected route matches GET status and hidden-miss', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET, jwtIssuer: 'neumann' });
    const getHealth = await app.inject({ method: 'GET', url: '/health' });
    const headHealth = await app.inject({ method: 'HEAD', url: '/health' });
    expect(getHealth.statusCode).toBe(200);
    expect(headHealth.statusCode).toBe(getHealth.statusCode);

    const getList = await app.inject({ method: 'GET', url: '/api/v2/ontologies' });
    const headList = await app.inject({ method: 'HEAD', url: '/api/v2/ontologies' });
    expect(getList.statusCode).toBe(401);
    expect(headList.statusCode).toBe(401);

    const token = signDevToken({ secret: SECRET, principal: 'alice', issuer: 'neumann' });
    const headers = { authorization: `Bearer ${token}` };
    const getAuth = await app.inject({ method: 'GET', url: '/api/v2/ontologies', headers });
    const headAuth = await app.inject({ method: 'HEAD', url: '/api/v2/ontologies', headers });
    expect(getAuth.statusCode).toBe(200);
    expect(headAuth.statusCode).toBe(200);
    expect(getAuth.json()).toEqual({ data: [] });
    await app.close();
  });

  it('render, catalog search, catalog types, and Functions never leak hidden properties or denied types', async () => {
    const overlay = createOntologyAuthorizer({
      roles: { alice: ['ops'] },
      grants: [
        {
          role: 'ops',
          ontologyIds: ['*'],
          objectTypes: ['ot.order', 'ot.customer'],
          functions: ['*'],
          operations: ['read', 'modify'],
          hiddenProperties: ['ssn'],
          adminResources: [
            'render',
            'catalog.search',
            'catalog.types',
            'ontology.list',
            'ontology.read',
          ],
        },
      ],
    });
    const ctx = createMemoryPlatformContext({ policy: overlay });
    const o = await ctx.ontology.createOntology({ name: 'sec' });
    await ctx.ontology.addPropertyType(o.id, { id: 'ssn', displayName: 'SSN', baseType: 'string' });
    await ctx.ontology.addPropertyType(o.id, { id: 'note', displayName: 'Note', baseType: 'string' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: ['ssn', 'note'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.customer',
      displayName: 'Customer',
      propertyTypeIds: ['ssn', 'note'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.secret',
      displayName: 'Secret',
      propertyTypeIds: ['note'],
    });
    const published = await ctx.functionArtifacts.publish(
      artifactBytesFromSource(AGGREGATE_METRICS_SOURCE),
      'test',
    );
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.aggregateMetrics',
      apiName: 'aggregateMetrics',
      displayName: 'aggregateMetrics',
      inputObjectTypeIds: ['ot.order'],
      artifactHash: published.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: 'O1',
      properties: { ssn: 'HIDDEN-SSN', note: 'visible' },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.secret',
      primaryKey: 'S1',
      properties: { note: 'classified' },
    });

    const { app } = await createPlatformServer(ctx);
    const headers = { 'x-principal': 'alice' };

    const render = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.order/O1/render`,
      headers,
      payload: { template: 'note={{note}} ssn={{ssn}}' },
    });
    expect(render.statusCode).toBe(200);
    expect(render.json().document).toContain('visible');
    expect(render.json().document).not.toContain('HIDDEN-SSN');

    const searchHidden = await app.inject({
      method: 'GET',
      url: `/api/v2/catalog/search?q=HIDDEN-SSN&ontology=${o.id}`,
      headers,
    });
    expect(searchHidden.statusCode).toBe(200);
    expect(searchHidden.json().data).toEqual([]);

    const searchNote = await app.inject({
      method: 'GET',
      url: `/api/v2/catalog/search?q=visible&ontology=${o.id}`,
      headers,
    });
    expect(searchNote.statusCode).toBe(200);
    const hit = searchNote.json().data[0] as { properties: Record<string, unknown> };
    expect(hit.properties.note).toBe('visible');
    expect(hit.properties.ssn).toBeUndefined();

    const searchDenied = await app.inject({
      method: 'GET',
      url: `/api/v2/catalog/search?q=classified&ontology=${o.id}`,
      headers,
    });
    expect(searchDenied.json().data).toEqual([]);

    const types = await app.inject({ method: 'GET', url: '/api/v2/catalog/types', headers });
    expect(types.statusCode).toBe(200);
    const listed = types.json().data as Array<{ objectTypeId: string }>;
    expect(listed.map((t) => t.objectTypeId).sort()).toEqual(['ot.customer', 'ot.order']);
    expect(listed.some((t) => t.objectTypeId === 'ot.secret')).toBe(false);

    const fn = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/aggregateMetrics/execute`,
      headers,
      payload: {
        refs: [{ objectTypeId: 'ot.order', primaryKey: 'O1' }],
        params: { property: 'amount' },
      },
    });
    expect(fn.statusCode).toBe(202);
    expect(await ctx.functionWorker.drainOnce()).toBe(1);
    const done = await ctx.functions.get(fn.json().executionId, 'alice');
    expect(done?.status).toBe('SUCCEEDED');
    expect(JSON.stringify(done)).not.toContain('HIDDEN-SSN');
    expect(done?.objectSnapshot[0]?.properties).not.toHaveProperty('ssn');
    await app.close();
  });
});
