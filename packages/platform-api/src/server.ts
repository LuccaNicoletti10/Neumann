/**
 * platform-api — src/server.ts
 */

import Fastify from 'fastify';
import { NeumannApiError } from 'api-errors';

import { createMemoryPlatformContext, type PlatformContext } from './core/context.js';
import { registerV2Routes } from './routes/v2.js';

export async function createPlatformServer(ctx?: PlatformContext) {
  const context = ctx ?? createMemoryPlatformContext();
  if (process.env.PLATFORM_MODE === 'postgres' && context.mode !== 'postgres') {
    throw new Error('PLATFORM_MODE=postgres but context is not postgres — refuse memory fallback');
  }
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NeumannApiError) {
      return reply.code(err.statusCode).send(err.toJSON());
    }
    const message = err instanceof Error ? err.message : String(err);
    const status =
      /not found/i.test(message) ? 404
        : /conflict|already exists|version conflict/i.test(message) ? 409
          : /invalid|required|unsupported/i.test(message) ? 400
            : 500;
    return reply.code(status).send(
      new NeumannApiError({
        errorCode: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 400 ? 'INVALID_ARGUMENT' : 'INTERNAL',
        errorName: 'UnhandledError',
        message: process.env.NODE_ENV === 'production' && status === 500 ? 'Internal error' : message,
      }).toJSON(),
    );
  });

  await registerV2Routes(app, context);
  return { app, ctx: context };
}
