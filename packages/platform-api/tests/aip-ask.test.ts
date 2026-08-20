/**
 * platform-api — AIP ask smoke (Passo 35).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('AIP ask route', () => {
  afterEach(() => {
    delete process.env.PLATFORM_JWT_SECRET;
    delete process.env.AIP_LLM_BASE_URL;
    delete process.env.AIP_LLM_API_KEY;
  });

  it('asks with MockLlm in non-production and returns citations shape', async () => {
    process.env.PLATFORM_JWT_SECRET = SECRET;
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'aip' });
    await ctx.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'string' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.item',
      displayName: 'Item',
      propertyTypeIds: ['n'],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.item',
      primaryKey: 'A1',
      properties: { n: 'Widget' },
    });

    const { app } = await createPlatformServer(ctx, {
      jwtSecret: SECRET,
      jwtIssuer: 'neumann',
    });
    const token = signDevToken({
      secret: SECRET,
      principal: 'alice',
      issuer: 'neumann',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/aip/ask`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'What object types exist?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      answer: string;
      toolsUsed: string[];
      citations: unknown[];
      modelId: string;
      traceId: string;
    };
    expect(body.toolsUsed).toContain('list_object_types');
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.traceId).toBeTruthy();
    expect(body.modelId).toMatch(/mock/);
    await app.close();
  });

  it('production without AIP_LLM_* fails closed', async () => {
    process.env.PLATFORM_JWT_SECRET = SECRET;
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'aip-prod' });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    const { app } = await createPlatformServer(ctx, {
      jwtSecret: SECRET,
      jwtIssuer: 'neumann',
    });
    const token = signDevToken({
      secret: SECRET,
      principal: 'alice',
      issuer: 'neumann',
    });
    // WHY: assertProductionConfig runs at listen/bootstrap; LLM fail-closed is per-request.
    process.env.PLATFORM_ENV = 'production';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/aip/ask`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'ping' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(String(res.json().message ?? res.body)).toMatch(/AIP_LLM/);
    await app.close();
    delete process.env.PLATFORM_ENV;
  });
});
