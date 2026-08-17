/**
 * platform-api — tests/auth.test.ts
 * JWT HS256 verifier + fail-closed production boot.
 */
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import {
  AuthenticationError,
  createHmacTokenVerifier,
  signDevToken,
} from '../src/core/token-verifier.js';
import { createJwksProvider } from '../src/auth/jwks-provider.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

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
    delete process.env.PLATFORM_JWKS_URL;
    try {
      await expect(createPlatformServer(createMemoryPlatformContext())).rejects.toThrow(
        /PLATFORM_JWKS_URL|PLATFORM_JWT_SECRET/,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('JWKS IdentityProvider', () => {
  it('verifies RS256, caches by kid, and maps JWKS outage to 503', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'kid-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    let keys = [jwk];
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(String(req.url));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const jwksUrl = `http://127.0.0.1:${addr.port}/jwks`;
    try {
      const provider = createJwksProvider({ jwksUrl, cacheMaxAgeMs: 1 });
      const token = await new SignJWT({ sub: 'alice' })
        .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(privateKey);
      const first = await provider.verify(token);
      expect(first.principal).toBe('alice');
      await provider.verify(token);
      expect(hits.length).toBeGreaterThanOrEqual(1);

      const rotated = await generateKeyPair('RS256', { extractable: true });
      const jwk2 = await exportJWK(rotated.publicKey);
      jwk2.kid = 'kid-2';
      jwk2.alg = 'RS256';
      jwk2.use = 'sig';
      keys = [jwk2];
      await new Promise((r) => setTimeout(r, 20));
      const stale = await new SignJWT({ sub: 'bob' })
        .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(privateKey);
      await expect(provider.verify(stale)).rejects.toBeInstanceOf(AuthenticationError);

      const down = createJwksProvider({
        jwksUrl: 'http://127.0.0.1:1/jwks',
        cacheMaxAgeMs: 1,
      });
      const doomed = await new SignJWT({ sub: 'x' })
        .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(privateKey);
      try {
        await down.verify(doomed);
        expect.fail('expected JWKS failure');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthenticationError);
        expect((err as AuthenticationError).statusCode).toBe(503);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it('createPlatformServer verifies a real RS256 token via JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'api-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const jwksUrl = `http://127.0.0.1:${addr.port}/jwks`;
    try {
      const { app } = await createPlatformServer(createMemoryPlatformContext(), { jwksUrl });
      const token = await new SignJWT({ sub: 'svc-projector' })
        .setProtectedHeader({ alg: 'RS256', kid: 'api-1' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(privateKey);
      const ok = await app.inject({
        method: 'GET',
        url: '/api/v2/ontologies',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
      const expired = await new SignJWT({ sub: 'svc-projector' })
        .setProtectedHeader({ alg: 'RS256', kid: 'api-1' })
        .setIssuedAt()
        .setExpirationTime('0s')
        .sign(privateKey);
      const expRes = await app.inject({
        method: 'GET',
        url: '/api/v2/ontologies',
        headers: { authorization: `Bearer ${expired}` },
      });
      expect(expRes.statusCode).toBe(401);
      await app.close();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
