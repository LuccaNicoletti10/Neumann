/**
 * platform-api — catalog search (policy-filtered, empty not 403).
 */
import { describe, expect, it } from 'vitest';
import { createOntologyAuthorizer } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('catalog search', () => {
  it('search finds by pk and omits types without grant (empty, not 403)', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'cat' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'note',
      displayName: 'Note',
      baseType: 'string',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: ['note'],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.thing',
      primaryKey: 'alpha-1',
      properties: { note: 'hello-catalog' },
    });
    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });
    const token = signDevToken({ secret: SECRET, principal: 'svc-projector' });
    const hit = await app.inject({
      method: 'GET',
      url: `/api/v2/catalog/search?q=alpha&ontology=${o.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data?.[0]?.urn).toEqual(expect.stringContaining('alpha-1'));
    await app.close();

    const locked = createMemoryPlatformContext({
      authorizer: createOntologyAuthorizer({
        roles: { 'svc-projector': ['none'] },
        grants: [{ role: 'none', ontologyIds: ['*'], objectTypes: ['ot.other'], operations: ['read'] }],
      }),
    });
    const onto = await locked.ontology.createOntology({ name: 'cat2' });
    await locked.ontology.addPropertyType(onto.id, {
      id: 'note',
      displayName: 'Note',
      baseType: 'string',
    });
    await locked.ontology.addObjectType(onto.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: ['note'],
    });
    await locked.ontology.commit({ ontologyId: onto.id, createdBy: 'test' });
    await locked.objects.create({
      ontologyId: onto.id,
      objectTypeId: 'ot.thing',
      primaryKey: 'alpha-1',
      properties: { note: 'hello-catalog' },
    });
    const { app: app2 } = await createPlatformServer(locked, { jwtSecret: SECRET });
    const hidden = await app2.inject({
      method: 'GET',
      url: `/api/v2/catalog/search?q=alpha&ontology=${onto.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data).toEqual([]);
    await app2.close();
  });
});
