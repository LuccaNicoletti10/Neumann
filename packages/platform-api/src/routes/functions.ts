/**
 * platform-api — FunctionRuntime HTTP adapter (ADR-0019).
 * Handler only calls FunctionRuntime. No sandbox, SQL, or repository.
 */

import type { FastifyInstance } from 'fastify';
import { ResourceIds } from 'policy-engine';

import type { PlatformContext } from '../core/context.js';
import { principalOf } from '../core/principal.js';
import { declarePolicy } from '../core/route-policy.js';
import {
  FunctionDeniedError,
  FunctionIdempotencyConflictError,
  FunctionInvalidParametersError,
  FunctionSnapshotUnavailableError,
} from 'function-registry';

export async function registerFunctionRoutes(
  app: FastifyInstance,
  ctx: PlatformContext,
): Promise<void> {
  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/functions',
    declarePolicy('read', (req) => ResourceIds.ontology((req.params as { ontology: string }).ontology), 'empty-list'),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.functionTypes) };
    },
  );

  app.get<{ Params: { ontology: string; fn: string } }>(
    '/api/v2/ontologies/:ontology/functions/:fn',
    declarePolicy(
      'read',
      (req) =>
        ResourceIds.function(
          (req.params as { ontology: string }).ontology,
          (req.params as { fn: string }).fn,
        ),
      'not-found',
    ),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      const def =
        v?.functionTypes[req.params.fn] ??
        Object.values(v?.functionTypes ?? {}).find(
          (row) => row.apiName === req.params.fn || row.id === req.params.fn,
        );
      if (!def) return reply.code(404).send({ error: 'function not found' });
      return def;
    },
  );

  app.post<{
    Params: { ontology: string; fn: string };
    Body: {
      refs?: Array<{ objectTypeId: string; primaryKey: string }>;
      params?: Record<string, unknown>;
      ontologyVersionId?: string;
      idempotencyKey?: string;
    };
  }>(
    '/api/v2/ontologies/:ontology/functions/:fn/execute',
    declarePolicy('modify', (req) =>
      ResourceIds.function(
        (req.params as { ontology: string }).ontology,
        (req.params as { fn: string }).fn,
      ),
    ),
    async (req, reply) => {
      const body = req.body ?? {};
      try {
        const execution = await ctx.functions.create({
          ontologyId: req.params.ontology,
          functionId: req.params.fn,
          principal: principalOf(req),
          parameters: body.params,
          objectRefs: body.refs,
          ontologyVersionId: body.ontologyVersionId,
          idempotencyKey: body.idempotencyKey,
        });
        return reply.code(202).send(execution);
      } catch (err) {
        if (err instanceof FunctionDeniedError) {
          return reply.code(404).send({ error: 'function not found' });
        }
        if (err instanceof FunctionInvalidParametersError) {
          return reply.code(400).send({ errorName: 'INVALID_PARAMETERS' });
        }
        if (err instanceof FunctionIdempotencyConflictError) {
          return reply.code(409).send({ errorName: err.errorName });
        }
        if (err instanceof FunctionSnapshotUnavailableError) {
          return reply.code(409).send({ errorName: err.errorName });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { ontology: string; executionId: string } }>(
    '/api/v2/ontologies/:ontology/function-executions/:executionId',
    declarePolicy(
      'read',
      (req) => ResourceIds.ontology((req.params as { ontology: string }).ontology),
      'not-found',
    ),
    async (req, reply) => {
      const execution = await ctx.functions.get(req.params.executionId, principalOf(req));
      if (!execution) return reply.code(404).send({ error: 'not found' });
      return execution;
    },
  );

  app.post<{ Params: { ontology: string; executionId: string } }>(
    '/api/v2/ontologies/:ontology/function-executions/:executionId/cancel',
    declarePolicy('modify', (req) => ResourceIds.ontology((req.params as { ontology: string }).ontology)),
    async (req, reply) => {
      try {
        return await ctx.functions.cancel(req.params.executionId, principalOf(req));
      } catch (err) {
        if (err instanceof FunctionDeniedError) {
          return reply.code(404).send({ error: 'not found' });
        }
        throw err;
      }
    },
  );
}
