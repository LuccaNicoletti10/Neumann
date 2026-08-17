/**
 * platform-api — src/core/token-verifier.ts
 * HMAC-SHA256 JWT adapter. Swap for RS256/JWKS via TokenVerifier without
 * rewriting routes. Does not replace packages/iam-auth-monitoring IdentityProvider.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export class AuthenticationError extends Error {
  readonly errorCode = 'UNAUTHENTICATED';
  readonly statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = statusCode;
  }
}

export interface VerifiedPrincipal {
  principal: string;
  claims: Record<string, unknown>;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedPrincipal>;
}

export interface CreateHmacTokenVerifierOptions {
  secret: string;
  issuer?: string;
  clockToleranceSec?: number;
  now?: () => number;
}

export interface SignDevTokenOptions {
  secret: string;
  principal: string;
  ttlSec?: number;
  issuer?: string;
  now?: () => number;
}

function base64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signDevToken(opts: SignDevTokenOptions): string {
  const now = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  const ttl = opts.ttlSec ?? 3600;
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64urlEncode(
    JSON.stringify({
      sub: opts.principal,
      iat: now,
      exp: now + ttl,
      ...(opts.issuer ? { iss: opts.issuer } : {}),
    }),
  );
  const signing = `${header}.${payload}`;
  const signature = base64urlEncode(hmac(opts.secret, signing));
  return `${signing}.${signature}`;
}

export function createHmacTokenVerifier(
  opts: CreateHmacTokenVerifierOptions,
): TokenVerifier {
  return createHs256Verifier(opts);
}

/** Current HS256 verifier, renamed for IdentityProvider composition. */
export function createHs256Verifier(
  opts: CreateHmacTokenVerifierOptions,
): TokenVerifier {
  const tolerance = opts.clockToleranceSec ?? 0;

  return {
    async verify(token: string): Promise<VerifiedPrincipal> {
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        throw new AuthenticationError('malformed token');
      }
      const [headerB64, payloadB64, signatureB64] = parts;
      let header: { alg?: string };
      try {
        header = JSON.parse(base64urlDecode(headerB64).toString('utf8')) as { alg?: string };
      } catch {
        throw new AuthenticationError('malformed token header');
      }
      if (header.alg !== 'HS256') {
        throw new AuthenticationError(`unsupported token alg: ${header.alg ?? 'none'}`);
      }

      const expected = hmac(opts.secret, `${headerB64}.${payloadB64}`);
      let actual: Buffer;
      try {
        actual = base64urlDecode(signatureB64);
      } catch {
        throw new AuthenticationError('malformed token signature');
      }
      if (!safeEqual(expected, actual)) {
        throw new AuthenticationError('invalid token signature');
      }

      let claims: Record<string, unknown>;
      try {
        claims = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        throw new AuthenticationError('malformed token payload');
      }

      const now = Math.floor((opts.now?.() ?? Date.now()) / 1000);
      if (typeof claims.exp === 'number' && now > claims.exp + tolerance) {
        throw new AuthenticationError('token expired');
      }
      if (typeof claims.nbf === 'number' && now + tolerance < claims.nbf) {
        throw new AuthenticationError('token not yet valid');
      }
      if (opts.issuer && claims.iss !== opts.issuer) {
        throw new AuthenticationError('token issuer mismatch');
      }

      const principal =
        (typeof claims.sub === 'string' && claims.sub) ||
        (typeof claims.principal === 'string' && claims.principal) ||
        '';
      if (!principal) {
        throw new AuthenticationError('token missing principal (sub)');
      }
      return { principal, claims };
    },
  };
}
