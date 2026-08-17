/**
 * platform-api — function execute (Passo 23).
 */
import { describe, expect, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('Passo 23 — functions HTTP', () => {
  it('GET list + POST execute scoreRecord', async () => {
    const ctx = createMemoryPlatformContext();
    const o = await ctx.ontology.createOntology({ name: 'fn' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.customer',
      displayName: 'Customer',
      propertyTypeIds: [],
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.scoreRecord',
      displayName: 'scoreRecord',
      apiName: 'scoreRecord',
      inputObjectTypeIds: ['ot.customer'],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.customer',
      primaryKey: 'A',
      properties: { name: 'ACME', amount: 80 },
    });

    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });
    const token = signDevToken({ secret: SECRET, principal: 'svc-projector' });
    const headers = { authorization: `Bearer ${token}` };

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/functions`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((d: { apiName: string }) => d.apiName === 'scoreRecord')).toBe(
      true,
    );

    const exec = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/scoreRecord/execute`,
      headers,
      payload: {
        objects: [{ objectTypeId: 'ot.customer', primaryKey: 'A', properties: { name: 'ACME', amount: 80 } }],
      },
    });
    expect(exec.statusCode).toBe(200);
    expect(exec.json().version).toBe('1');
    expect(exec.json().result.scores[0].score).toBeGreaterThan(0);

    const viaRef = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/aggregateMetrics/execute`,
      headers,
      payload: {
        refs: [{ objectTypeId: 'ot.customer', primaryKey: 'A' }],
        params: { property: 'amount' },
      },
    });
    expect(viaRef.statusCode).toBe(200);
    expect(viaRef.json().result.sum).toBe(80);

    await app.close();
  });
});
