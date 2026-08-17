/**
 * platform-api — catalog search + webhook ingest.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOntologyAuthorizer } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('catalog + ingest', () => {
  it('search finds by pk and omits types without grant (empty, not 403)', async () => {
    const ctx = createMemoryPlatformContext();
    const o = await ctx.ontology.createOntology({ name: 'cat' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: [],
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
        grants: [{ role: 'none', objectTypes: ['ot.other'], operations: ['read'] }],
      }),
    });
    const onto = await locked.ontology.createOntology({ name: 'cat2' });
    await locked.ontology.addObjectType(onto.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: [],
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

  it('webhook ingest rejects invalid signature with 401', async () => {
    const prev = process.env.PLATFORM_INGEST_SECRET;
    process.env.PLATFORM_INGEST_SECRET = 'whsec';
    try {
      const { app } = await createPlatformServer(createMemoryPlatformContext(), {
        jwtSecret: SECRET,
      });
      const token = signDevToken({ secret: SECRET, principal: 'svc-projector' });
      const bad = await app.inject({
        method: 'POST',
        url: '/api/v2/ingest/webhook',
        headers: {
          authorization: `Bearer ${token}`,
          'x-neumann-signature': 'deadbeef',
        },
        payload: { id: 'e1' },
      });
      expect(bad.statusCode).toBe(401);
      const raw = JSON.stringify({ id: 'e1' });
      const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v2/ingest/webhook',
        headers: {
          authorization: `Bearer ${token}`,
          'x-neumann-signature': sig,
        },
        payload: { id: 'e1' },
      });
      expect(ok.statusCode).toBe(202);
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_INGEST_SECRET;
      else process.env.PLATFORM_INGEST_SECRET = prev;
    }
  });
});
