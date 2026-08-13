/**
 * platform-api — src/server.ts
 */

import Fastify from 'fastify';
import { NeumannApiError } from 'api-errors';
import { OntologyValidationError } from 'object-platform';

import { createMemoryPlatformContext, type PlatformContext } from './core/context.js';
import { ReadForbiddenError } from './core/secured-reads.js';
import { bindPrincipalHook, principalOf } from './core/principal.js';
import {
  AuthenticationError,
  createHmacTokenVerifier,
  type TokenVerifier,
} from './core/token-verifier.js';
import { registerWriteGuard } from './core/write-guard.js';
import { registerV2Routes } from './routes/v2.js';

export interface CreatePlatformServerOptions {
  tokenVerifier?: TokenVerifier;
  jwtSecret?: string;
  jwtIssuer?: string;
}

function resolveTokenVerifier(opts: CreatePlatformServerOptions): TokenVerifier | undefined {
  if (opts.tokenVerifier) return opts.tokenVerifier;
  const secret = opts.jwtSecret ?? process.env.PLATFORM_JWT_SECRET;
  if (!secret) return undefined;
  return createHmacTokenVerifier({
    secret,
    issuer: opts.jwtIssuer ?? process.env.PLATFORM_JWT_ISSUER,
  });
}

export async function createPlatformServer(
  ctx?: PlatformContext,
  opts: CreatePlatformServerOptions = {},
) {
  const context = ctx ?? createMemoryPlatformContext();
  if (process.env.PLATFORM_MODE === 'postgres' && context.mode !== 'postgres') {
    throw new Error('PLATFORM_MODE=postgres but context is not postgres — refuse memory fallback');
  }

  if (process.env.NODE_ENV === 'production') {
    const secret = opts.jwtSecret ?? opts.tokenVerifier ?? process.env.PLATFORM_JWT_SECRET;
    if (!secret) {
      throw new Error(
        'NODE_ENV=production requires PLATFORM_JWT_SECRET (fail-closed authentication)',
      );
    }
  }

  const verifier = resolveTokenVerifier(opts);
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Principal',
    );
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    return payload;
  });
  app.options('*', async (_req, reply) => reply.code(204).send());

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async () => ({ status: 'ready', mode: context.mode }));

  app.addHook('onRequest', bindPrincipalHook(verifier));

  registerWriteGuard(app, {
    allowedPrincipals: ['svc-projector', 'svc-migration'],
    principalOf,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NeumannApiError) {
      return reply.code(err.statusCode).send(err.toJSON());
    }
    if (err instanceof AuthenticationError) {
      return reply.code(401).send({
        errorCode: 'UNAUTHENTICATED',
        errorName: 'AuthenticationError',
        message: err.message,
      });
    }
    if (err instanceof OntologyValidationError) {
      return reply.code(400).send({
        errorCode: 'ONTOLOGY_VALIDATION_FAILED',
        errorName: 'OntologyValidationError',
        message: err.message,
        violations: err.violations,
      });
    }
    if (err instanceof ReadForbiddenError) {
      return reply.code(403).send({
        errorCode: err.errorCode,
        errorName: err.errorName,
        message: err.message,
      });
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
  return { app, ctx: context, verifier };
}
