/**
 * platform-api — src/core/principal.ts
 * Shared principal extraction + request-scoped AsyncLocalStorage.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';

export const principalAls = new AsyncLocalStorage<string>();

export function getCurrentPrincipal(): string | undefined {
  return principalAls.getStore();
}

export function principalOf(req: {
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

export function runWithPrincipal<T>(principal: string, fn: () => T): T {
  return principalAls.run(principal, fn);
}

export function bindPrincipalHook(): (
  req: FastifyRequest,
  _reply: unknown,
  done: (err?: Error) => void,
) => void {
  return (req, _reply, done) => {
    principalAls.run(principalOf(req), () => done());
  };
}
