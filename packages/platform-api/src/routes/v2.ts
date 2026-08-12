/**
 * platform-api — src/routes/v2.ts
 * Foundry-like /api/v2 routes (adapted from OpenFoundry Apache-2.0 conventions).
 */

import type { FastifyInstance } from 'fastify';
import type {
  ActionTypeDef,
  ObjectSet,
  ObjectSetAggregation,
  ObjectSetFilter,
} from 'contracts';
import { aggregateObjects, loadObjects } from 'object-set';

import type { PlatformContext } from '../core/context.js';

function principalOf(req: { headers: Record<string, string | string[] | undefined> }): string {
  const h = req.headers['x-principal'];
  return typeof h === 'string' && h ? h : 'anonymous';
}

function normalizeObjectSet(raw: Record<string, unknown>): ObjectSet {
  const type = String(raw.type ?? '').toUpperCase();
  switch (type) {
    case 'BASE':
      return { type: 'BASE', objectType: String(raw.objectType) };
    case 'FILTER':
      return {
        type: 'FILTER',
        objectSet: normalizeObjectSet(raw.objectSet as Record<string, unknown>),
        filter: (raw.filter ?? raw.where) as ObjectSetFilter,
      };
    case 'UNION':
      return {
        type: 'UNION',
        objectSets: ((raw.objectSets as Record<string, unknown>[]) ?? []).map(normalizeObjectSet),
      };
    case 'INTERSECT':
      return {
        type: 'INTERSECT',
        objectSets: ((raw.objectSets as Record<string, unknown>[]) ?? []).map(normalizeObjectSet),
      };
    case 'SUBTRACT': {
      const sets = ((raw.objectSets as Record<string, unknown>[]) ?? []).map(normalizeObjectSet);
      return { type: 'SUBTRACT', objectSets: [sets[0]!, sets[1]!] };
    }
    case 'STATIC':
      return {
        type: 'STATIC',
        objectType: String(raw.objectType),
        primaryKeys: (raw.primaryKeys as string[]) ?? [],
      };
    case 'SEARCH_AROUND':
    case 'SEARCHAROUND':
      return {
        type: 'SEARCH_AROUND',
        objectSet: normalizeObjectSet(raw.objectSet as Record<string, unknown>),
        link: String(raw.link),
      };
    default:
      throw new Error(`unsupported ObjectSet type: ${type}`);
  }
}

export async function registerV2Routes(
  app: FastifyInstance,
  ctx: PlatformContext,
): Promise<void> {
  app.get('/api/v2/ontologies', async () => {
    // Registry has no listAll — return empty until we add it; create via POST.
    return { data: [] };
  });

  app.post<{ Body: { name: string; description?: string } }>(
    '/api/v2/ontologies',
    async (req, reply) => {
      const o = ctx.ontology.createOntology({
        name: req.body.name,
        description: req.body.description,
        createdBy: principalOf(req),
      });
      return reply.code(201).send(o);
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology',
    async (req, reply) => {
      const o = ctx.ontology.getOntology(req.params.ontology);
      if (!o) return reply.code(404).send({ error: 'ontology not found' });
      return o;
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/objectTypes',
    async (req, reply) => {
      const v = ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.objectTypes) };
    },
  );

  app.get<{ Params: { ontology: string; objectType: string } }>(
    '/api/v2/ontologies/:ontology/objectTypes/:objectType',
    async (req, reply) => {
      const v = ctx.ontology.getLatestVersion(req.params.ontology);
      const ot = v?.objectTypes[req.params.objectType];
      if (!ot) return reply.code(404).send({ error: 'objectType not found' });
      return ot;
    },
  );

  app.get<{ Params: { ontology: string; objectType: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType',
    async (req) => {
      const data = await ctx.objects.list(req.params.ontology, req.params.objectType);
      return { data };
    },
  );

  app.get<{ Params: { ontology: string; objectType: string; primaryKey: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey',
    async (req, reply) => {
      const obj = await ctx.objects.get(
        req.params.ontology,
        req.params.objectType,
        req.params.primaryKey,
      );
      if (!obj) return reply.code(404).send({ error: 'object not found' });
      return obj;
    },
  );

  app.post<{
    Params: { ontology: string; objectType: string };
    Body: { primaryKey: string; properties?: Record<string, unknown>; source?: string };
  }>('/api/v2/ontologies/:ontology/objects/:objectType', async (req, reply) => {
    const obj = await ctx.objects.create({
      ontologyId: req.params.ontology,
      objectTypeId: req.params.objectType,
      primaryKey: req.body.primaryKey,
      properties: req.body.properties,
      source: req.body.source ?? 'api',
    });
    ctx.events.append({
      kind: 'ObjectCreated',
      ontologyId: req.params.ontology,
      principal: principalOf(req),
      objectId: obj.id,
      objectTypeId: obj.objectTypeId,
      primaryKey: obj.primaryKey,
    });
    return reply.code(201).send(obj);
  });

  app.put<{
    Params: { ontology: string; objectType: string; primaryKey: string };
    Body: { properties: Record<string, unknown> };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey',
    async (req) => {
      const obj = await ctx.objects.update(
        req.params.ontology,
        req.params.objectType,
        req.params.primaryKey,
        { properties: req.body.properties },
      );
      ctx.events.append({
        kind: 'ObjectModified',
        ontologyId: req.params.ontology,
        principal: principalOf(req),
        objectId: obj.id,
        objectTypeId: obj.objectTypeId,
        primaryKey: obj.primaryKey,
      });
      return obj;
    },
  );

  app.delete<{ Params: { ontology: string; objectType: string; primaryKey: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey',
    async (req, reply) => {
      await ctx.objects.delete(
        req.params.ontology,
        req.params.objectType,
        req.params.primaryKey,
      );
      return reply.code(204).send();
    },
  );

  app.get<{
    Params: { ontology: string; objectType: string; primaryKey: string; linkType: string };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey/links/:linkType',
    async (req) => {
      const edges = await ctx.links.listFrom(
        req.params.ontology,
        req.params.objectType,
        req.params.primaryKey,
        req.params.linkType,
      );
      const data = [];
      for (const e of edges) {
        const t = await ctx.objects.get(
          req.params.ontology,
          e.targetObjectTypeId,
          e.targetPrimaryKey,
        );
        if (t) data.push(t);
      }
      return { data };
    },
  );

  app.post<{
    Params: { ontology: string; objectType: string; primaryKey: string; linkType: string };
    Body: { targetObjectType: string; targetPrimaryKey: string; cardinality?: string };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey/links/:linkType',
    async (req, reply) => {
      const link = await ctx.links.create({
        ontologyId: req.params.ontology,
        linkTypeId: req.params.linkType,
        sourceObjectTypeId: req.params.objectType,
        sourcePrimaryKey: req.params.primaryKey,
        targetObjectTypeId: req.body.targetObjectType,
        targetPrimaryKey: req.body.targetPrimaryKey,
        cardinality: req.body.cardinality as
          | '1:1'
          | '1:N'
          | 'N:1'
          | 'N:N'
          | undefined,
      });
      ctx.events.append({
        kind: 'LinkCreated',
        ontologyId: req.params.ontology,
        principal: principalOf(req),
        linkId: link.id,
        linkTypeId: link.linkTypeId,
      });
      return reply.code(201).send(link);
    },
  );

  app.post<{
    Params: { ontology: string };
    Body: {
      objectSet: Record<string, unknown>;
      orderBy?: { property: string; direction?: 'asc' | 'desc' }[];
      pageSize?: number;
      pageToken?: string;
    };
  }>('/api/v2/ontologies/:ontology/objectSets/loadObjects', async (req) => {
    return loadObjects(
      {
        objectSet: normalizeObjectSet(req.body.objectSet),
        orderBy: req.body.orderBy,
        pageSize: req.body.pageSize,
        pageToken: req.body.pageToken,
      },
      {
        ontologyId: req.params.ontology,
        objects: ctx.objects,
        links: ctx.links,
      },
    );
  });

  app.post<{
    Params: { ontology: string };
    Body: {
      objectSet: Record<string, unknown>;
      aggregations: ObjectSetAggregation[];
    };
  }>('/api/v2/ontologies/:ontology/objectSets/aggregate', async (req) => {
    const data = await aggregateObjects(
      {
        objectSet: normalizeObjectSet(req.body.objectSet),
        aggregations: req.body.aggregations,
      },
      {
        ontologyId: req.params.ontology,
        objects: ctx.objects,
        links: ctx.links,
      },
    );
    return { data };
  });

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/actionTypes',
    async (req, reply) => {
      const v = ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.actionTypes) };
    },
  );

  app.post<{
    Params: { ontology: string };
    Body: ActionTypeDef;
  }>('/api/v2/ontologies/:ontology/actionTypes', async (req, reply) => {
    ctx.ontology.openDraft(req.params.ontology);
    ctx.ontology.addActionType(req.params.ontology, req.body);
    ctx.ontology.commit({ ontologyId: req.params.ontology, createdBy: principalOf(req) });
    ctx.actions.registerActionType(req.params.ontology, req.body);
    return reply.code(201).send(req.body);
  });

  app.post<{
    Params: { ontology: string; action: string };
    Body: { parameters: Record<string, unknown> };
  }>('/api/v2/ontologies/:ontology/actions/:action/validate', async (req) => {
    return ctx.actions.validate({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
    });
  });

  app.post<{
    Params: { ontology: string; action: string };
    Body: {
      parameters: Record<string, unknown>;
      idempotencyKey?: string;
      expectedObjectVersions?: Record<string, number>;
    };
  }>('/api/v2/ontologies/:ontology/actions/:action/apply', async (req) => {
    return ctx.actions.apply({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
      idempotencyKey: req.body.idempotencyKey,
      expectedObjectVersions: req.body.expectedObjectVersions,
    });
  });
}
