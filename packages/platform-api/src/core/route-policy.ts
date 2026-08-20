/**
 * Declarative route policy. Callers declare {operation, resourceResolver, hiddenMiss};
 * a single preHandler evaluates ctx.policy.authorize before the handler.
 *
 * Invariants:
 * - Public exceptions: GET|HEAD /health, GET|HEAD /ready, OPTIONS.
 * - Boot fails if any other route lacks a declaration or uses an unknown operation.
 * - Deny happens before the handler. hiddenMiss preserves empty-list / not-found.
 * - HEAD inherits the GET route's policy (no global HEAD bypass).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { PolicyOperation } from 'contracts';
import { authorizeProceeds } from 'contracts';

import type { PlatformContext } from './context.js';
import { principalOf } from './principal.js';

export type HiddenMiss = false | 'empty-list' | 'not-found';

export const POLICY_OPERATIONS: readonly PolicyOperation[] = [
  'read',
  'create',
  'modify',
  'delete',
  'list',
  'count',
];

export interface RoutePolicyDeclaration {
  operation: PolicyOperation;
  resourceResolver: (request: FastifyRequest) => string;
  hiddenMiss?: HiddenMiss;
  /** Body for hiddenMiss empty-list when `{ data: [] }` is the wrong shape. */
  emptyBody?: unknown;
}

export type RoutePolicyConfig =
  | RoutePolicyDeclaration
  | { public: true }
  | { hmacIngress: true };

declare module 'fastify' {
  interface FastifyContextConfig {
    policy?: RoutePolicyConfig;
  }
}

export const PUBLIC_ROUTE_PATHS = new Set(['/health', '/ready']);

export interface ClassifiedRoute {
  method: string;
  url: string;
  policy: RoutePolicyConfig | undefined;
}

const registryByApp = new WeakMap<FastifyInstance, ClassifiedRoute[]>();

export function declarePolicy(
  operation: PolicyOperation,
  resourceResolver: (request: FastifyRequest) => string,
  hiddenMiss: HiddenMiss = false,
  emptyBody?: unknown,
): { config: { policy: RoutePolicyDeclaration } } {
  return { config: { policy: { operation, resourceResolver, hiddenMiss, emptyBody } } };
}

export function declareHmacIngress(): { config: { policy: { hmacIngress: true } } } {
  return { config: { policy: { hmacIngress: true } } };
}

export function declarePublicRoute(): { config: { policy: { public: true } } } {
  return { config: { policy: { public: true } } };
}

export function isHmacIngressPath(method: string, url: string): boolean {
  const m = method.toUpperCase();
  const path = normalizeUrl(url);
  if (m !== 'POST') return false;
  return path === '/api/v2/ingest/:connectorId' || /^\/api\/v2\/ingest\/[^/]+$/.test(path);
}

export class PolicyDeniedError extends Error {
  readonly statusCode = 403;
  readonly errorCode = 'POLICY_DENIED';
  readonly errorName = 'PolicyDeniedError';
  constructor(message: string) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

function normalizeUrl(url: string): string {
  return url.split('?')[0] ?? url;
}

export function isPublicRoute(method: string, url: string, _policy?: RoutePolicyConfig): boolean {
  const m = method.toUpperCase();
  const path = normalizeUrl(url);
  if (m === 'OPTIONS') return true;
  if ((m === 'GET' || m === 'HEAD') && PUBLIC_ROUTE_PATHS.has(path)) return true;
  return false;
}

function publicDeclarationAllowed(method: string, url: string): boolean {
  const m = method.toUpperCase();
  const path = normalizeUrl(url);
  if (m === 'OPTIONS') return true;
  return (m === 'GET' || m === 'HEAD') && PUBLIC_ROUTE_PATHS.has(path);
}

export function collectRoute(
  route: Pick<RouteOptions, 'method' | 'url' | 'config'>,
  into: ClassifiedRoute[],
): void {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) {
    into.push({
      method: String(method).toUpperCase(),
      url: route.url,
      policy: route.config?.policy,
    });
  }
}

export function resetCollectedRoutes(): void {
  /* instance registry is per Fastify; kept for tests that pass an explicit list */
}

export function listCollectedRoutes(app?: FastifyInstance): ClassifiedRoute[] {
  if (!app) return [];
  return [...(registryByApp.get(app) ?? [])];
}

/**
 * Fail-closed boot check. Unknown operations and missing declarations abort listen.
 */
export function assertRoutePolicyClosure(routes: readonly ClassifiedRoute[]): void {
  const ops = new Set<string>(POLICY_OPERATIONS);
  for (const r of routes) {
    if (r.policy && 'public' in r.policy && r.policy.public) {
      if (!publicDeclarationAllowed(r.method, r.url)) {
        throw new Error(`declarePublicRoute is not allowed on ${r.method} ${r.url}`);
      }
      continue;
    }
    if (r.policy && 'hmacIngress' in r.policy && r.policy.hmacIngress) {
      if (!isHmacIngressPath(r.method, r.url)) {
        throw new Error(`declareHmacIngress is not allowed on ${r.method} ${r.url}`);
      }
      continue;
    }
    if (isPublicRoute(r.method, r.url, r.policy)) continue;
    if (!r.policy) {
      throw new Error(`unclassified business route: ${r.method} ${r.url}`);
    }
    if (!('operation' in r.policy) || !ops.has(r.policy.operation)) {
      throw new Error(`unknown policy operation on ${r.method} ${r.url}`);
    }
    if (typeof r.policy.resourceResolver !== 'function') {
      throw new Error(`missing resourceResolver on ${r.method} ${r.url}`);
    }
  }
}

async function enforcePolicy(
  req: FastifyRequest,
  reply: FastifyReply,
  ctx: PlatformContext,
): Promise<void> {
  if (reply.sent) return;
  const method = req.method.toUpperCase();
  const url = req.routeOptions.url ?? req.url;
  if (isPublicRoute(method, String(url), req.routeOptions.config.policy)) return;
  const policy = req.routeOptions.config.policy;
  if (!policy) {
    throw new Error(`unclassified business route: ${method} ${url}`);
  }
  if ('hmacIngress' in policy && policy.hmacIngress) {
    if (!isHmacIngressPath(method, String(url))) {
      throw new Error(`declareHmacIngress is not allowed on ${method} ${url}`);
    }
    return;
  }
  if ('public' in policy && policy.public) {
    throw new Error(`declarePublicRoute is not allowed on ${method} ${url}`);
  }
  if (!('operation' in policy)) {
    throw new Error(`unclassified business route: ${method} ${url}`);
  }
  const resource = policy.resourceResolver(req);
  const result = ctx.policy.authorize({
    principal: principalOf(req),
    resource,
    operation: policy.operation,
  });
  if (authorizeProceeds(policy.operation, result)) return;
  const hidden = policy.hiddenMiss ?? false;
  if (hidden === 'empty-list') {
    return reply.code(200).send(policy.emptyBody ?? { data: [] });
  }
  if (hidden === 'not-found') {
    // WHY: same body as object GET handlers so deny is indistinguishable from miss.
    return reply.code(404).send({ error: 'object not found' });
  }
  throw new PolicyDeniedError(result.reason);
}

/**
 * Single enforcement hook. WHY: handlers must not reimplement authorize.
 */
export function registerRoutePolicyHook(app: FastifyInstance, ctx: PlatformContext): void {
  const collected: ClassifiedRoute[] = [];
  registryByApp.set(app, collected);
  app.addHook('onRoute', (route) => {
    collectRoute(route, collected);
  });
  app.addHook('onReady', async () => {
    assertRoutePolicyClosure(collected);
  });
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    await enforcePolicy(req, reply, ctx);
  });
}
