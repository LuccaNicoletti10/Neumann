/**
 * platform-api — src/routes/v2.ts
 * Foundry-like /api/v2 routes (adapted from OpenFoundry Apache-2.0 conventions).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  ActionTypeDef,
  GraphPattern,
  ObjectSet,
  ObjectSetAggregation,
} from 'contracts';
import { assertGraphPattern, urnOf } from 'contracts';
import { renderDocumentTemplate } from 'action-engine';
import { compileCatalogSearch, catalogHitUrn, normalizeFilter } from 'object-set';
import { catalogFromRepos, executeGraphPattern } from 'explore-api';
import { paginateArray } from 'pagination';
import { notFound } from 'api-errors';
import { ResourceIds } from 'policy-engine';

import type { PublicPlatformContext } from '../core/context.js';
import { principalOf } from '../core/principal.js';
import { declarePolicy } from '../core/route-policy.js';
import { createSecuredReads } from '../core/secured-reads.js';

function normalizeObjectSet(raw: Record<string, unknown>): ObjectSet {
  const type = String(raw.type ?? '').toUpperCase();
  switch (type) {
    case 'BASE':
      return { type: 'BASE', objectType: String(raw.objectType) };
    case 'FILTER':
      return {
        type: 'FILTER',
        objectSet: normalizeObjectSet(raw.objectSet as Record<string, unknown>),
        filter: normalizeFilter(raw.filter ?? raw.where),
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

function ont(req: FastifyRequest): string {
  return (req.params as { ontology: string }).ontology;
}

function ot(req: FastifyRequest): string {
  return (req.params as { objectType: string }).objectType;
}

function actionName(req: FastifyRequest): string {
  return (req.params as { action: string }).action;
}

function actionRequiredBody(): {
  errorCode: string;
  errorName: string;
  message: string;
} {
  return {
    errorCode: 'ACTION_REQUIRED',
    errorName: 'ActionRequired',
    message:
      'Object and link writes are not a public API. Use POST /api/v2/ontologies/{ontology}/actions/{action}/apply.',
  };
}

export async function registerV2Routes(
  app: FastifyInstance,
  ctx: PublicPlatformContext,
): Promise<void> {
  const reads = createSecuredReads(ctx);

  app.get('/api/v2/ontologies', declarePolicy('read', () => ResourceIds.admin('ontology.list'), 'empty-list'), async () => {
    return { data: await ctx.ontology.listOntologies() };
  });

  app.post<{ Body: { name: string; description?: string } }>(
    '/api/v2/ontologies',
    declarePolicy('create', () => ResourceIds.admin('ontology.create')),
    async (req, reply) => {
      const o = await ctx.ontology.createOntology({
        name: req.body.name,
        description: req.body.description,
        createdBy: principalOf(req),
      });
      return reply.code(201).send(o);
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'not-found'),
    async (req, _reply) => {
      const o = await ctx.ontology.getOntology(req.params.ontology);
      if (!o) throw notFound('OntologyNotFound', 'ontology not found', { ontology: req.params.ontology });
      return o;
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/latestVersion',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'not-found'),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return v;
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/versions/latest',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'not-found'),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return v;
    },
  );

  app.get<{ Params: { objectId: string } }>(
    '/api/v2/objects/:objectId/history',
    declarePolicy('read', () => ResourceIds.admin('ontology.read'), 'empty-list'),
    async (req) => ({ data: await reads.listHistory(principalOf(req), req.params.objectId) }),
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/objectTypes',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'empty-list'),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.objectTypes) };
    },
  );

  app.get<{ Params: { ontology: string; objectType: string } }>(
    '/api/v2/ontologies/:ontology/objectTypes/:objectType',
    declarePolicy('read', (req) => ResourceIds.objectType(ont(req), ot(req)), 'not-found'),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      const def = v?.objectTypes[req.params.objectType];
      if (!def) return reply.code(404).send({ error: 'objectType not found' });
      return def;
    },
  );

  app.get<{ Params: { ontology: string; objectType: string }; Querystring: { pageSize?: string; pageToken?: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType',
    declarePolicy('read', (req) => ResourceIds.objectType(ont(req), ot(req)), 'empty-list'),
    async (req) => {
      const data = await reads.listObjects(
        principalOf(req),
        req.params.ontology,
        req.params.objectType,
      );
      return paginateArray(data, {
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
        pageToken: req.query.pageToken,
      }, { idOf: (o) => o.id, maxPageSize: 1000, defaultPageSize: 100 });
    },
  );

  app.get<{ Params: { ontology: string; objectType: string; primaryKey: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey',
    declarePolicy('read', (req) => ResourceIds.objectType(ont(req), ot(req)), 'not-found'),
    async (req, reply) => {
      const obj = await reads.getObject(
        principalOf(req),
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
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType',
    declarePolicy('create', (req) => ResourceIds.objectType(ont(req), ot(req))),
    async (_req, reply) => reply.code(405).send(actionRequiredBody()),
  );

  app.put<{
    Params: { ontology: string; objectType: string; primaryKey: string };
    Body: { properties: Record<string, unknown> };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey',
    declarePolicy('modify', (req) => ResourceIds.objectType(ont(req), ot(req))),
    async (_req, reply) => reply.code(405).send(actionRequiredBody()),
  );

  app.delete<{ Params: { ontology: string; objectType: string; primaryKey: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey',
    declarePolicy('delete', (req) => ResourceIds.objectType(ont(req), ot(req))),
    async (_req, reply) => reply.code(405).send(actionRequiredBody()),
  );

  app.get<{
    Params: { ontology: string; objectType: string; primaryKey: string; linkType: string };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey/links/:linkType',
    declarePolicy('read', (req) => ResourceIds.linkType(ont(req), (req.params as { linkType: string }).linkType), 'empty-list'),
    async (req) => ({
      data: await reads.listLinkTargets(
        principalOf(req),
        req.params.ontology,
        req.params.objectType,
        req.params.primaryKey,
        req.params.linkType,
      ),
    }),
  );

  app.post<{
    Params: { ontology: string; objectType: string; primaryKey: string; linkType: string };
    Body: { targetObjectType: string; targetPrimaryKey: string; cardinality?: string };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey/links/:linkType',
    declarePolicy('modify', (req) => ResourceIds.objectType(ont(req), ot(req))),
    async (_req, reply) => reply.code(405).send(actionRequiredBody()),
  );

  app.post<{
    Params: { ontology: string };
    Body: {
      objectSet: Record<string, unknown>;
      orderBy?: { property: string; direction?: 'asc' | 'desc' }[];
      pageSize?: number;
      pageToken?: string;
    };
  }>(
    '/api/v2/ontologies/:ontology/objectSets/loadObjects',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'empty-list'),
    async (req) => {
    return reads.loadObjectSet(principalOf(req), req.params.ontology, {
      objectSet: normalizeObjectSet(req.body.objectSet),
      orderBy: req.body.orderBy,
      pageSize: req.body.pageSize,
      pageToken: req.body.pageToken,
    });
    },
  );

  app.post<{
    Params: { ontology: string };
    Body: {
      objectSet: Record<string, unknown>;
      aggregations: ObjectSetAggregation[];
    };
  }>(
    '/api/v2/ontologies/:ontology/objectSets/aggregate',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'empty-list', {
      data: { count: 0 },
    }),
    async (req) => {
    const data = await reads.aggregateObjectSet(principalOf(req), req.params.ontology, {
      objectSet: normalizeObjectSet(req.body.objectSet),
      aggregations: req.body.aggregations,
    });
    return { data };
    },
  );

  app.post<{
    Params: { ontology: string };
    Body: { pattern: GraphPattern; limit?: number };
  }>(
    '/api/v2/ontologies/:ontology/graphPatterns/execute',
    declarePolicy('read', (req) => ResourceIds.ontology(ont(req)), 'empty-list', {
      matches: [],
      total: 0,
    }),
    async (req) => {
    const pattern = req.body.pattern;
    assertGraphPattern(pattern);
    const objectTypeIds = [...new Set(pattern.nodes.map((n) => String(n.objectTypeId)))];
    const catalog = await catalogFromRepos({
      ontologyId: req.params.ontology,
      objectTypeIds,
      objects: ctx.objects,
      links: ctx.links,
    });
    return executeGraphPattern({
      catalog,
      pattern,
      principal: principalOf(req),
      authorizer: ctx.policy,
      limit: req.body.limit,
    });
  });

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/actionTypes',
    declarePolicy('read', () => ResourceIds.admin('actionType.read'), 'empty-list'),
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.actionTypes) };
    },
  );

  app.post<{
    Params: { ontology: string };
    Body: ActionTypeDef;
  }>(
    '/api/v2/ontologies/:ontology/actionTypes',
    declarePolicy('create', () => ResourceIds.admin('actionType.write')),
    async (req, reply) => {
    await ctx.ontology.openDraft(req.params.ontology);
    await ctx.ontology.addActionType(req.params.ontology, req.body);
    await ctx.ontology.commit({ ontologyId: req.params.ontology, createdBy: principalOf(req) });
    return reply.code(201).send(req.body);
    },
  );

  app.post<{
    Params: { ontology: string; action: string };
    Body: { parameters: Record<string, unknown> };
  }>(
    '/api/v2/ontologies/:ontology/actions/:action/validate',
    declarePolicy('modify', (req) => ResourceIds.action(ont(req), actionName(req))),
    async (req) => {
    return ctx.actions.validate({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
    });
    },
  );

  app.post<{
    Params: { ontology: string; action: string };
    Body: {
      parameters: Record<string, unknown>;
      idempotencyKey?: string;
      expectedObjectVersions?: Record<string, number>;
    };
  }>(
    '/api/v2/ontologies/:ontology/actions/:action/apply',
    declarePolicy('modify', (req) => ResourceIds.action(ont(req), actionName(req))),
    async (req) => {
    return ctx.actions.apply({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
      idempotencyKey: req.body.idempotencyKey,
      expectedObjectVersions: req.body.expectedObjectVersions,
    });
    },
  );

  app.post<{
    Params: { ontology: string; action: string };
    Body: { parameters?: Record<string, unknown> };
  }>(
    '/api/v2/ontologies/:ontology/actions/:action/parameter-tree',
    declarePolicy('read', (req) => ResourceIds.action(ont(req), actionName(req))),
    async (req) => {
    if (!ctx.actions.parameterTree) {
      throw new Error('parameterTree not supported');
    }
    return ctx.actions.parameterTree({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
    });
    },
  );

  app.post<{
    Params: { ontology: string; objectType: string; primaryKey: string };
    Body: { template: string };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey/render',
    declarePolicy('read', () => ResourceIds.admin('render')),
    async (req) => {
      const obj = await reads.getObject(
        principalOf(req),
        req.params.ontology,
        req.params.objectType,
        req.params.primaryKey,
      );
      if (!obj) {
        throw notFound('ObjectNotFound', 'object not found', {
          ontology: req.params.ontology,
          objectType: req.params.objectType,
          primaryKey: req.params.primaryKey,
        });
      }
      return {
        document: renderDocumentTemplate(req.body.template ?? '', obj.properties),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v2/actions/executions/:id/approve',
    declarePolicy('modify', () => ResourceIds.admin('action-execution')),
    async (req) => {
      const principal = principalOf(req);
      if (!ctx.actions.approve) throw new Error('approvals not supported');
      return ctx.actions.approve(req.params.id, principal);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v2/actions/executions/:id/reject',
    declarePolicy('modify', () => ResourceIds.admin('action-execution')),
    async (req) => {
      const principal = principalOf(req);
      if (!ctx.actions.reject) throw new Error('approvals not supported');
      return ctx.actions.reject(req.params.id, principal);
    },
  );

  app.get<{ Querystring: { q?: string; ontology?: string; limit?: string } }>(
    '/api/v2/catalog/search',
    declarePolicy('read', () => ResourceIds.admin('catalog.search'), 'empty-list'),
    async (req) => {
      const q = String(req.query.q ?? '').trim();
      const principal = principalOf(req);
      if (!q) return { data: [] };
      if (ctx.sql) {
        const compiled = compileCatalogSearch({
          q,
          ontologyId: req.query.ontology,
          limit: req.query.limit ? Number(req.query.limit) : 25,
        });
        const result = await ctx.sql.query(compiled.text, compiled.params);
        const hits = [];
        for (const row of result.rows as Array<Record<string, unknown>>) {
          const objectTypeId = String(row.object_type_id);
          if (!ctx.policy.canReadObjectType(principal, objectTypeId, String(row.ontology_id))) {
            continue;
          }
          const properties = ctx.policy.redactProperties(
            principal,
            objectTypeId,
            (row.properties as Record<string, unknown>) ?? {},
            String(row.ontology_id),
          );
          const needle = q.toLowerCase();
          const pk = String(row.primary_key);
          if (
            !pk.toLowerCase().includes(needle) &&
            !JSON.stringify(properties).toLowerCase().includes(needle)
          ) {
            continue;
          }
          hits.push({
            urn: catalogHitUrn({
              ontology_id: String(row.ontology_id),
              object_type_id: objectTypeId,
              primary_key: pk,
            }),
            ontologyId: String(row.ontology_id),
            objectTypeId,
            primaryKey: pk,
            properties,
          });
        }
        return { data: hits };
      }
      const ontologies = req.query.ontology
        ? [{ id: req.query.ontology }]
        : await ctx.ontology.listOntologies();
      const needle = q.toLowerCase();
      const data = [];
      for (const onto of ontologies) {
        const v = await ctx.ontology.getLatestVersion(onto.id);
        for (const t of Object.values(v?.objectTypes ?? {})) {
          const listed = await ctx.objects.list(onto.id, t.id);
          for (const o of listed) {
            if (o.deleted) continue;
            if (!ctx.policy.canReadObjectType(principal, o.objectTypeId, o.ontologyId)) {
              continue;
            }
            const visible = ctx.policy.redactProperties(
              principal,
              o.objectTypeId,
              o.properties,
              o.ontologyId,
            );
            const blob = JSON.stringify(visible).toLowerCase();
            if (!o.primaryKey.toLowerCase().includes(needle) && !blob.includes(needle)) continue;
            data.push({
              urn: urnOf(o.ontologyId, o.objectTypeId, o.primaryKey),
              ontologyId: o.ontologyId,
              objectTypeId: o.objectTypeId,
              primaryKey: o.primaryKey,
              properties: visible,
            });
          }
        }
      }
      return { data };
    },
  );

  app.get(
    '/api/v2/catalog/types',
    declarePolicy('read', () => ResourceIds.admin('catalog.types'), 'empty-list'),
    async (req) => {
    const principal = principalOf(req);
    const ontologies = await ctx.ontology.listOntologies();
    const data = [];
    for (const o of ontologies) {
      const v = await ctx.ontology.getLatestVersion(o.id);
      const types = Object.values(v?.objectTypes ?? {});
      for (const t of types) {
        if (!ctx.policy.canReadObjectType(principal, t.id, o.id)) continue;
        const objs = await ctx.objects.list(o.id, t.id);
        data.push({
          ontologyId: o.id,
          objectTypeId: t.id,
          displayName: t.displayName,
          count: objs.filter((x) => !x.deleted).length,
        });
      }
    }
    return { data };
  });
}
