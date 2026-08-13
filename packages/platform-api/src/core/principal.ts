/**
 * platform-api — src/core/principal.ts
 * Shared principal extraction + request-scoped AsyncLocalStorage.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  AuthenticationError,
  type TokenVerifier,
} from './token-verifier.js';

export const principalAls = new AsyncLocalStorage<string>();

const PUBLIC_PATHS = new Set(['/health', '/ready']);

export function getCurrentPrincipal(): string | undefined {
  return principalAls.getStore();
}

export function extractDevPrincipal(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const allowDev = process.env.ALLOW_DEV_PRINCIPAL_HEADER === 'true';
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const xPrincipal = req.headers['x-principal'];
  if (typeof xPrincipal === 'string' && xPrincipal) {
    if (nodeEnv !== 'production' || allowDev) return xPrincipal;
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return 'anonymous';
}

/**
 * Resolve principal from ALS (after bindPrincipalHook) or headers (dev / tests).
 * When a TokenVerifier is bound, missing/invalid tokens never become 'anonymous'.
 */
export function principalOf(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  return principalAls.getStore() ?? extractDevPrincipal(req);
}

export function extractBearerToken(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    return token || undefined;
  }
  return undefined;
}

export function runWithPrincipal<T>(principal: string, fn: () => T): T {
  return principalAls.run(principal, fn);
}

function sendUnauthenticated(reply: FastifyReply, message: string): void {
  void reply.code(401).send({
    errorCode: 'UNAUTHENTICATED',
    errorName: 'AuthenticationError',
    message,
  });
}

/**
 * Fastify onRequest hook. Uses callback style so AsyncLocalStorage wraps the
 * rest of the request (done() runs inside principalAls.run).
 */
export function bindPrincipalHook(verifier?: TokenVerifier) {
  return (
    req: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void,
  ): void => {
    const url = req.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(url)) {
      done();
      return;
    }

    if (!verifier) {
      principalAls.run(extractDevPrincipal(req), () => done());
      return;
    }

    const token = extractBearerToken(req);
    if (!token) {
      sendUnauthenticated(reply, 'missing bearer token');
      done();
      return;
    }

    verifier
      .verify(token)
      .then((verified) => {
        principalAls.run(verified.principal, () => done());
      })
      .catch((err: unknown) => {
        const message =
          err instanceof AuthenticationError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'authentication failed';
        sendUnauthenticated(reply, message);
        done();
      });
  };
}

export { AuthenticationError };
