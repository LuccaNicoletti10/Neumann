/**
 * auth-hook.ts — middleware de autenticacao (fastify preHandler).
 *
 * Componente do passo: resolve o principal de CADA request a partir de
 * `Authorization: Bearer <token>` ou header `X-API-Key` e anexa em
 * `request.principal`. Rotas publicas (ex.: /login, /register) passam sem
 * principal. Rota protegida sem principal valido -> 401.
 *
 * GATE DO PASSO: login funciona e todo request carrega principal.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IdentityProvider } from './identity-provider.js';
import type { Principal } from './principal-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export interface AuthHookOptions {
  /** Prefixos de rota publicos (matching por prefixo, ex.: '/login' cobre '/login'). */
  publicRoutes?: string[];
}

export function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth !== undefined && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token.length > 0) return token;
  }
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) return apiKey;
  return null;
}

export function isPublicRoute(url: string, publicRoutes: string[]): boolean {
  const path = url.split('?')[0] ?? url;
  return publicRoutes.some((route) => path === route || path.startsWith(`${route}/`));
}

export function createAuthHook(provider: IdentityProvider, options: AuthHookOptions = {}) {
  const publicRoutes = options.publicRoutes ?? ['/login', '/register'];
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractToken(request);
    request.principal = token !== null ? provider.resolveToken(token) : null;
    if (isPublicRoute(request.url, publicRoutes)) return;
    if (request.principal === null) {
      await reply.code(401).send({ error: 'unauthorized', message: 'principal invalido ou ausente' });
    }
  };
}

/** Guard para rotas administrativas: exige role 'admin'. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.principal === null || !request.principal.roles.includes('admin')) {
    await reply.code(403).send({ error: 'forbidden', message: 'role admin necessaria' });
  }
}
