/**
 * observability — src/demo-server.ts
 *
 * Servidor Fastify de demonstracao com plugin de observabilidade e rotas
 * usadas pelo gate TM0.5 (/health, /echo, /work).
 */

import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DestinationStream } from 'pino';
import { createRootLogger } from './logger.js';
import { registerObservabilityPlugin } from './fastify-plugin.js';
import { shutdownTracing } from './tracing.js';
import type { PrincipalContext, ServiceIdentity } from './types.js';

export interface DemoServerOptions {
  identity?: ServiceIdentity;
  logDestination?: DestinationStream;
  otlpUrl?: string;
  resolvePrincipal?: (req: FastifyRequest) => PrincipalContext;
}

export interface StartedDemoServer {
  app: FastifyInstance;
  port: number;
  host: string;
  close: () => Promise<void>;
}

export const DEFAULT_DEMO_IDENTITY: ServiceIdentity = {
  service: 'observability-demo',
  version: '1.0.0',
  deploymentId: 'local-dev',
};

export async function createDemoServer(
  options: DemoServerOptions = {},
): Promise<FastifyInstance> {
  const identity = options.identity ?? DEFAULT_DEMO_IDENTITY;
  const rootLogger = createRootLogger(identity, { level: 'info' }, options.logDestination);

  const app = Fastify({
    logger: false,
  });

  await registerObservabilityPlugin(app, {
    identity,
    rootLogger,
    otlpUrl: options.otlpUrl,
    resolvePrincipal: options.resolvePrincipal,
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/echo', async (req, reply) => {
    const principalHeader = req.headers['x-principal-id'];
    if (typeof principalHeader !== 'string' || principalHeader.length === 0) {
      return reply.code(403).send({ error: 'X-Principal-Id required' });
    }
    return {
      echo: req.url,
      principal: req.principal.id,
      tenant_id: req.principal.tenantId,
    };
  });

  app.post('/work', async (req, reply) => {
    const body = req.body as { fail?: boolean; deny?: boolean } | undefined;
    if (body?.deny) {
      return reply.code(403).send({ error: 'denied' });
    }
    if (body?.fail) {
      return reply.code(500).send({ error: 'work failed' });
    }
    return { done: true };
  });

  app.setNotFoundHandler(async (_req, reply) => {
    return reply.code(404).send({ error: 'not found' });
  });

  return app;
}

export async function startDemoServer(
  port: number,
  host = '127.0.0.1',
  options: DemoServerOptions = {},
): Promise<StartedDemoServer> {
  const app = await createDemoServer(options);
  await app.listen({ port, host });
  const address = app.server.address();
  const resolvedPort =
    typeof address === 'object' && address !== null ? address.port : port;

  return {
    app,
    port: resolvedPort,
    host,
    close: async () => {
      await app.close();
      await shutdownTracing();
    },
  };
}
