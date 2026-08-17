/**
 * platform-api — src/auth/jwks-provider.ts
 * RS256/ES256 JWT verification via JWKS (jose). Cache keys by kid, TTL 10 min.
 */

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';

import { AuthenticationError, type TokenVerifier, type VerifiedPrincipal } from '../core/token-verifier.js';

export interface IdentityProvider {
  verify(token: string): Promise<VerifiedPrincipal>;
}

export type Hs256Verifier = TokenVerifier;

export interface AuthEventSink {
  recordAttempt(event: {
    principal?: string;
    success: boolean;
    reason?: string;
    at?: string;
  }): void;
}

export interface CreateJwksProviderOptions {
  jwksUrl: string;
  issuer?: string;
  audience?: string;
  cacheMaxAgeMs?: number;
  now?: () => number;
  sink?: AuthEventSink;
}

const JWKS_UNAVAILABLE = 'jwks unavailable';

export function createJwksProvider(opts: CreateJwksProviderOptions): IdentityProvider {
  const JWKS = createRemoteJWKSet(new URL(opts.jwksUrl), {
    cacheMaxAge: opts.cacheMaxAgeMs ?? 10 * 60 * 1000,
    cooldownDuration: opts.cacheMaxAgeMs !== undefined ? 0 : undefined,
  });

  return {
    async verify(token: string): Promise<VerifiedPrincipal> {
      try {
        const { payload } = await jwtVerify(token, JWKS, {
          issuer: opts.issuer,
          audience: opts.audience,
        });
        const principal =
          (typeof payload.sub === 'string' && payload.sub) ||
          (typeof payload.principal === 'string' && payload.principal) ||
          '';
        if (!principal) throw new AuthenticationError('token missing principal (sub)');
        opts.sink?.recordAttempt({ principal, success: true });
        return { principal, claims: payload as Record<string, unknown> };
      } catch (err) {
        if (err instanceof AuthenticationError) {
          opts.sink?.recordAttempt({ success: false, reason: err.message });
          throw err;
        }
        const message = err instanceof Error ? err.message : 'invalid token';
        const infra =
          err instanceof joseErrors.JWKSNoMatchingKey ||
          err instanceof joseErrors.JWKSTimeout ||
          /fetch|ECONNREFUSED|ENOTFOUND|JWKS|network/i.test(message);
        if (infra) {
          const wrapped = new AuthenticationError(`${JWKS_UNAVAILABLE}: retry`, 503);
          opts.sink?.recordAttempt({ success: false, reason: JWKS_UNAVAILABLE });
          throw wrapped;
        }
        opts.sink?.recordAttempt({ success: false, reason: message });
        throw new AuthenticationError(message);
      }
    },
  };
}

export { JWKS_UNAVAILABLE };
