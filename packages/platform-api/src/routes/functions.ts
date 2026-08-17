/**
 * platform-api — src/routes/functions.ts
 * Passo 23 — invoke de functions puras.
 */

import type { FastifyInstance } from 'fastify';
import type { FunctionObjectInput } from 'contracts';

import type { PlatformContext } from '../core/context.js';

export async function registerFunctionRoutes(
  app: FastifyInstance,
  ctx: PlatformContext,
): Promise<void> {
  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/functions',
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      const registered = ctx.functions.list();
      const declared = Object.values(v.functionTypes);
      return {
        data: registered,
        ontology: declared,
      };
    },
  );

  app.get<{ Params: { ontology: string; fn: string } }>(
    '/api/v2/ontologies/:ontology/functions/:fn',
    async (req, reply) => {
      const def = ctx.functions.get(req.params.fn);
      if (!def) return reply.code(404).send({ error: 'function not found' });
      return { ...def, versions: ctx.functions.listVersions(req.params.fn) };
    },
  );

  app.post<{
    Params: { ontology: string; fn: string };
    Body: {
      objects?: FunctionObjectInput[];
      refs?: Array<{ objectTypeId: string; primaryKey: string }>;
      params?: Record<string, unknown>;
      version?: string;
    };
  }>('/api/v2/ontologies/:ontology/functions/:fn/execute', async (req, reply) => {
    const body = req.body ?? {};
    const objects: FunctionObjectInput[] = [...(body.objects ?? [])];
    for (const ref of body.refs ?? []) {
      const rec = await ctx.objects.get(req.params.ontology, ref.objectTypeId, ref.primaryKey);
      if (!rec || rec.deleted) {
        return reply.code(404).send({
          error: `object not found: ${ref.objectTypeId}/${ref.primaryKey}`,
        });
      }
      objects.push({
        objectTypeId: rec.objectTypeId,
        primaryKey: rec.primaryKey,
        properties: { ...rec.properties },
      });
    }
    if (objects.length === 0) {
      return reply.code(400).send({ error: 'objects or refs required' });
    }
    const result = ctx.functions.invoke({
      functionId: req.params.fn,
      version: body.version,
      objects,
      params: body.params,
    });
    return result;
  });
}
