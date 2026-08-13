/**
 * platform-api — tests/auth.test.ts
 * JWT HS256 verifier + fail-closed production boot.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import {
  AuthenticationError,
  createHmacTokenVerifier,
  signDevToken,
} from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('HMAC token verifier', () => {
  it('accepts a valid token and rejects tampered / expired / missing iss', async () => {
    const verifier = createHmacTokenVerifier({ secret: SECRET, issuer: 'neumann' });
    const token = signDevToken({ secret: SECRET, principal: 'fernanda', issuer: 'neumann' });
    const ok = await verifier.verify(token);
    expect(ok.principal).toBe('fernanda');

    const tampered = `${token.slice(0, -2)}aa`;
    await expect(verifier.verify(tampered)).rejects.toBeInstanceOf(AuthenticationError);

    const expired = signDevToken({
      secret: SECRET,
      principal: 'fernanda',
      issuer: 'neumann',
      ttlSec: -10,
    });
    await expect(verifier.verify(expired)).rejects.toThrow(/expired/);

    const wrongIss = signDevToken({ secret: SECRET, principal: 'fernanda', issuer: 'other' });
    await expect(verifier.verify(wrongIss)).rejects.toThrow(/issuer/);
  });
});

describe('platform-api JWT hook', () => {
  afterEach(() => {
    delete process.env.PLATFORM_JWT_SECRET;
  });

  it('health stays public; missing/invalid/expired tokens return 401', async () => {
    const ctx = createMemoryPlatformContext();
    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET, jwtIssuer: 'neumann' });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const missing = await app.inject({ method: 'GET', url: '/api/v2/ontologies' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().errorCode).toBe('UNAUTHENTICATED');

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v2/ontologies',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(bad.statusCode).toBe(401);

    const expired = signDevToken({
      secret: SECRET,
      principal: 'lucca',
      issuer: 'neumann',
      ttlSec: -5,
    });
    const expRes = await app.inject({
      method: 'GET',
      url: '/api/v2/ontologies',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(expRes.statusCode).toBe(401);

    await app.close();
  });

  it('svc-projector token may write objects; fernanda is 403 ActionsOnlyWritePath', async () => {
    const ctx = createMemoryPlatformContext();
    const o = await ctx.ontology.createOntology({ name: 'authz' });
    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });

    const projector = signDevToken({ secret: SECRET, principal: 'svc-projector' });
    const allowed = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing`,
      headers: { authorization: `Bearer ${projector}` },
      payload: { primaryKey: '1', properties: { n: 1 } },
    });
    expect(allowed.statusCode).toBe(201);

    const human = signDevToken({ secret: SECRET, principal: 'fernanda' });
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing`,
      headers: { authorization: `Bearer ${human}` },
      payload: { primaryKey: '2', properties: { n: 2 } },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().errorName).toBe('ActionsOnlyWritePath');

    await app.close();
  });

  it('NODE_ENV=production without PLATFORM_JWT_SECRET fails boot', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.PLATFORM_JWT_SECRET;
    try {
      await expect(createPlatformServer(createMemoryPlatformContext())).rejects.toThrow(
        /PLATFORM_JWT_SECRET/,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
