/**
 * platform-api — src/server.ts
 */

import Fastify from 'fastify';
import { NeumannApiError } from 'api-errors';
import { OntologyValidationError, ProjectionConflictError, ProjectionDeniedError, VersionConflictError } from 'object-platform';

import { assertProductionConfig } from './core/assert-production-config.js';
import { type PlatformContext } from './core/context.js';
import { ReadForbiddenError } from './core/secured-reads.js';
import { bindPrincipalHook } from './core/principal.js';
import {
  AuthenticationError,
  createHmacTokenVerifier,
  type TokenVerifier,
} from './core/token-verifier.js';
import { createJwksProvider, type AuthEventSink } from './auth/jwks-provider.js';
import {
  assertRoutePolicyClosure,
  declarePublicRoute,
  listCollectedRoutes,
  PolicyDeniedError,
  registerRoutePolicyHook,
} from './core/route-policy.js';
import {
  ConnectorUnavailableError,
  IngestionDeniedError,
  IngestionEventConflictError,
  PayloadTooLargeError,
  WebhookAuthenticationError,
  WebhookNonceReuseError,
} from 'ingestion-runtime';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerV2Routes } from './routes/v2.js';
import { registerErRoutes } from './routes/er.js';
import { registerFunctionRoutes } from './routes/functions.js';
import { registerAipRoutes } from './routes/aip.js';
import {
  serializeHttpLogError,
  serializeHttpLogRequest,
  writeRedactedHttpLog,
} from './core/http-log.js';

export interface CreatePlatformServerOptions {
  tokenVerifier?: TokenVerifier;
  jwtSecret?: string;
  jwtIssuer?: string;
  jwksUrl?: string;
  authEventSink?: AuthEventSink;
  /**
   * Optional destination for the HTTP logger. Default is logger disabled.
   * `logger: false` is not a redaction proof; inject this stream in tests.
   */
  logDestination?: { write(msg: string): void };
}

function resolveTokenVerifier(opts: CreatePlatformServerOptions): TokenVerifier | undefined {
  if (opts.tokenVerifier) return wrapSink(opts.tokenVerifier, opts.authEventSink);
  const jwksUrl = opts.jwksUrl ?? process.env.PLATFORM_JWKS_URL;
  if (jwksUrl) {
    return createJwksProvider({
      jwksUrl,
      issuer: opts.jwtIssuer ?? process.env.PLATFORM_JWT_ISSUER,
      sink: opts.authEventSink,
    });
  }
  const secret = opts.jwtSecret ?? process.env.PLATFORM_JWT_SECRET;
  if (!secret) return undefined;
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[platform-api] PLATFORM_JWT_SECRET is HS256 dev mode; set PLATFORM_JWKS_URL for production RS256/ES256',
    );
  }
  return wrapSink(
    createHmacTokenVerifier({
      secret,
      issuer: opts.jwtIssuer ?? process.env.PLATFORM_JWT_ISSUER,
    }),
    opts.authEventSink,
  );
}

function wrapSink(verifier: TokenVerifier, sink?: AuthEventSink): TokenVerifier {
  if (!sink) return verifier;
  return {
    async verify(token: string) {
      try {
        const result = await verifier.verify(token);
        sink.recordAttempt({ principal: result.principal, success: true });
        return result;
      } catch (err) {
        sink.recordAttempt({
          success: false,
          reason: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  };
}

export async function createPlatformServer(
  ctx: PlatformContext,
  opts: CreatePlatformServerOptions = {},
) {
  const context = ctx;
  if (!context?.policy) {
    throw new Error('createPlatformServer requires a PlatformContext with policy (no implicit memory allow-all)');
  }
  if (!context.ready) {
    throw new Error('createPlatformServer refused: platform is not ready (hydrate/bootstrap incomplete)');
  }
  if (context.authorizer !== context.policy) {
    throw new Error('createPlatformServer refused: authorizer is not ctx.policy (second evaluator)');
  }
  if (process.env.PLATFORM_MODE === 'postgres' && context.mode !== 'postgres') {
    throw new Error('PLATFORM_MODE=postgres but context is not postgres — refuse memory fallback');
  }
  assertProductionConfig({
    mode: context.mode,
    ready: context.ready,
    policyDegraded: context.policy.degraded(),
    databaseUrl: process.env.DATABASE_URL,
  });

  if (process.env.NODE_ENV === 'production') {
    const jwks = opts.jwksUrl ?? process.env.PLATFORM_JWKS_URL;
    const secret = opts.jwtSecret ?? opts.tokenVerifier ?? process.env.PLATFORM_JWT_SECRET;
    if (!jwks && !secret) {
      throw new Error(
        'NODE_ENV=production requires PLATFORM_JWKS_URL or PLATFORM_JWT_SECRET (fail-closed authentication)',
      );
    }
  }

  const verifier = resolveTokenVerifier(opts);
  const destination = opts.logDestination;
  const app = destination
    ? Fastify({
        logger: {
          level: 'info',
          stream: { write: (msg: string) => writeRedactedHttpLog(destination, msg) },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-neumann-signature"]',
              'req.headers["x-neumann-nonce"]',
              'req.headers.cookie',
              'err.message',
              'err.stack',
            ],
            censor: '[redacted]',
          },
          serializers: {
            req: serializeHttpLogRequest,
            err: serializeHttpLogError,
          },
        },
      })
    : Fastify({ logger: false });
  registerRoutePolicyHook(app, context);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Principal, X-Neumann-Signature, X-Neumann-Timestamp, X-Neumann-Nonce',
    );
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    return payload;
  });
  app.options('*', { ...declarePublicRoute() }, async (_req, reply) => reply.code(204).send());

  app.get('/health', { ...declarePublicRoute() }, async () => ({ status: 'ok' }));
  app.get('/ready', { ...declarePublicRoute() }, async (_req, reply) => {
    // WHY: /health is liveness; /ready is 200 only after policy+seed and not during shutdown.
    if (!context.ready || context.policy.degraded()) {
      return reply.code(503).send({
        status: 'not-ready',
        mode: context.mode,
        degraded: context.policy.degraded(),
      });
    }
    return { status: 'ready', mode: context.mode };
  });

  app.addHook('onRequest', bindPrincipalHook(verifier));

  app.setErrorHandler((err, _req, reply) => {
    const code = (err as { code?: string }).code;
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE' || err instanceof PayloadTooLargeError) {
      return reply.code(413).send({
        errorCode: 'INVALID_ARGUMENT',
        errorName: 'PayloadTooLargeError',
        message: err instanceof Error ? err.message : 'payload too large',
      });
    }
    if (err instanceof IngestionEventConflictError) {
      return reply.code(409).send({
        errorCode: 'CONFLICT',
        errorName: 'INGESTION_EVENT_CONFLICT',
        message: err.message,
      });
    }
    if (err instanceof WebhookNonceReuseError) {
      return reply.code(409).send({
        errorCode: 'CONFLICT',
        errorName: err.errorName,
        message: err.message,
      });
    }
    if (err instanceof WebhookAuthenticationError) {
      return reply.code(401).send({
        errorCode: 'UNAUTHENTICATED',
        errorName: err.name,
        message: err.message,
      });
    }
    if (err instanceof ConnectorUnavailableError) {
      const status = err.statusCode;
      return reply.code(status).send({
        errorCode: status === 404 ? 'NOT_FOUND' : 'PERMISSION_DENIED',
        errorName: err.name,
        message: err.message,
      });
    }
    if (err instanceof IngestionDeniedError) {
      return reply.code(403).send({
        errorCode: 'PERMISSION_DENIED',
        errorName: 'IngestionDeniedError',
        message: err.message,
      });
    }
    if (err instanceof NeumannApiError) {
      return reply.code(err.statusCode).send(err.toJSON());
    }
    if (err instanceof AuthenticationError) {
      const status = (err as AuthenticationError & { statusCode?: number }).statusCode ?? 401;
      return reply.code(status).send({
        errorCode: status === 503 ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
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
    if (err instanceof PolicyDeniedError) {
      return reply.code(err.statusCode).send({
        errorCode: err.errorCode,
        errorName: err.errorName,
        message: err.message,
      });
    }
    if (err instanceof ProjectionDeniedError) {
      return reply.code(403).send({
        errorCode: 'PROJECTION_DENIED',
        errorName: 'ProjectionDeniedError',
        message: err.message,
      });
    }
    if (err instanceof ProjectionConflictError || err instanceof VersionConflictError) {
      return reply.code(409).send({
        errorCode: err instanceof VersionConflictError ? 'VERSION_CONFLICT' : 'PROJECTION_CONFLICT',
        errorName: err.name,
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
  await registerIngestRoutes(app, context);
  await registerErRoutes(app, context);
  await registerFunctionRoutes(app, context);
  await registerAipRoutes(app, context);
  assertRoutePolicyClosure(listCollectedRoutes(app));
  app.addHook('onClose', async () => {
    context.ready = false;
  });
  return { app, ctx: context, verifier };
}
