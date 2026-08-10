/**
 * observability — src/fastify-plugin.ts
 *
 * Plugin Fastify que instrumenta cada request com span OTel, child logger pino
 * e log de conclusao contendo todos os campos obrigatorios TM0.5.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { childForRequest, createRootLogger } from './logger.js';
import { REQUEST_LOG_MARKER } from './harness.js';
import { getTraceId, startTracing } from './tracing.js';
import type { PrincipalContext, RequestLogFields, ServiceIdentity } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: PrincipalContext;
    traceId: string;
    obsLogger: Logger;
    obsStartMs: number;
    obsOperation: string;
  }
}

export interface ObservabilityPluginOptions {
  identity: ServiceIdentity;
  rootLogger?: Logger;
  otlpUrl?: string;
  resolvePrincipal?: (req: FastifyRequest) => PrincipalContext;
}

function formatPrincipal(principal: PrincipalContext): string {
  if (principal.kind === 'anonymous') {
    return 'anonymous';
  }
  return `${principal.kind}:${principal.id}`;
}

function resolvePrincipalFromHeaders(req: FastifyRequest): PrincipalContext {
  const principalId = req.headers['x-principal-id'];
  const tenantId = req.headers['x-tenant-id'];

  if (typeof principalId === 'string' && principalId.length > 0) {
    return {
      id: principalId,
      kind: 'user',
      tenantId: typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : 'default',
    };
  }

  return {
    id: 'anonymous',
    kind: 'anonymous',
    tenantId: typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : 'default',
  };
}

function buildOperation(req: FastifyRequest): string {
  const routePath = req.routeOptions?.url ?? req.url.split('?')[0] ?? req.url;
  return `${req.method} ${routePath}`;
}

function resultFromStatus(statusCode: number): RequestLogFields['result'] {
  if (statusCode === 403) {
    return 'denied';
  }
  if (statusCode >= 200 && statusCode < 400) {
    return 'ok';
  }
  return 'error';
}

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const observabilityPluginImpl: FastifyPluginAsync<ObservabilityPluginOptions> = async (
  app,
  opts,
) => {
  startTracing({ identity: opts.identity, otlpUrl: opts.otlpUrl });
  const rootLogger = opts.rootLogger ?? createRootLogger(opts.identity);

  app.decorateRequest('principal', null as unknown as PrincipalContext);
  app.decorateRequest('traceId', '');
  app.decorateRequest('obsLogger', null as unknown as Logger);
  app.decorateRequest('obsStartMs', 0);
  app.decorateRequest('obsOperation', '');

  app.addHook('onRequest', async (req) => {
    req.obsStartMs = Date.now();

    const principal = opts.resolvePrincipal?.(req) ?? resolvePrincipalFromHeaders(req);
    req.principal = principal;

    const traceId = getTraceId() ?? generateTraceId();
    req.traceId = traceId;
    req.obsOperation = buildOperation(req);

    req.obsLogger = childForRequest(rootLogger, {
      trace_id: traceId,
      principal: formatPrincipal(principal),
      tenant_id: principal.tenantId,
      operation: req.obsOperation,
    });
  });

  app.addHook('preHandler', async (req) => {
    req.obsOperation = buildOperation(req);
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const durationMs = Math.max(0, Date.now() - req.obsStartMs);
    const result = resultFromStatus(reply.statusCode);
    const correlationId = req.headers['x-correlation-id'];
    const operation = buildOperation(req);
    const fields: RequestLogFields = {
      trace_id: req.traceId,
      principal: formatPrincipal(req.principal),
      tenant_id: req.principal.tenantId,
      service: opts.identity.service,
      version: opts.identity.version,
      deployment_id: opts.identity.deploymentId,
      operation,
      duration_ms: durationMs,
      result,
      ...(typeof correlationId === 'string' && correlationId.length > 0
        ? { correlation_id: correlationId }
        : {}),
    };

    req.obsLogger.info({ ...fields, msg: REQUEST_LOG_MARKER });
  });
};

export async function registerObservabilityPlugin(
  app: FastifyInstance,
  opts: ObservabilityPluginOptions,
): Promise<void> {
  // Apply hooks on the root instance (avoid Fastify encapsulation without fastify-plugin).
  await observabilityPluginImpl(app, opts);
}

/** Fastify plugin entry point — use registerObservabilityPlugin to avoid encapsulation pitfalls. */
export const observabilityPlugin = observabilityPluginImpl;
