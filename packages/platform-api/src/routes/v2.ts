/**
 * platform-api — src/routes/v2.ts
 * Foundry-like /api/v2 routes (adapted from OpenFoundry Apache-2.0 conventions).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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

import type { PlatformContext } from '../core/context.js';
import { principalOf } from '../core/principal.js';
import { createSecuredReads } from '../core/secured-reads.js';

function hmacHexEqual(raw: string, secret: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
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

export async function registerV2Routes(
  app: FastifyInstance,
  ctx: PlatformContext,
): Promise<void> {
  const reads = createSecuredReads(ctx);

  async function ensureActionType(ontologyId: string, action: string): Promise<void> {
    if (ctx.actions.getActionType(ontologyId, action)) return;
    const v = await ctx.ontology.getLatestVersion(ontologyId);
    const def = Object.values(v?.actionTypes ?? {}).find(
      (a) => a.apiName === action || a.id === action,
    );
    if (def) ctx.actions.registerActionType(ontologyId, def);
  }

  app.get('/api/v2/ontologies', async () => {
    return { data: await ctx.ontology.listOntologies() };
  });

  app.post<{ Body: { name: string; description?: string } }>(
    '/api/v2/ontologies',
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
    async (req, reply) => {
      const o = await ctx.ontology.getOntology(req.params.ontology);
      if (!o) throw notFound('OntologyNotFound', 'ontology not found', { ontology: req.params.ontology });
      return o;
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/latestVersion',
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return v;
    },
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/versions/latest',
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return v;
    },
  );

  app.get<{ Params: { objectId: string } }>(
    '/api/v2/objects/:objectId/history',
    async (req) => ({ data: await reads.listHistory(principalOf(req), req.params.objectId) }),
  );

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/objectTypes',
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.objectTypes) };
    },
  );

  app.get<{ Params: { ontology: string; objectType: string } }>(
    '/api/v2/ontologies/:ontology/objectTypes/:objectType',
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      const ot = v?.objectTypes[req.params.objectType];
      if (!ot) return reply.code(404).send({ error: 'objectType not found' });
      return ot;
    },
  );

  app.get<{ Params: { ontology: string; objectType: string }; Querystring: { pageSize?: string; pageToken?: string } }>(
    '/api/v2/ontologies/:ontology/objects/:objectType',
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
  }>('/api/v2/ontologies/:ontology/objects/:objectType', async (req, reply) => {
    const obj = await ctx.objects.create({
      ontologyId: req.params.ontology,
      objectTypeId: req.params.objectType,
      primaryKey: req.body.primaryKey,
      properties: req.body.properties,
      source: req.body.source ?? 'api',
    });
    await ctx.events.append({
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
      await ctx.events.append({
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
      await ctx.events.append({
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
    return reads.loadObjectSet(principalOf(req), req.params.ontology, {
      objectSet: normalizeObjectSet(req.body.objectSet),
      orderBy: req.body.orderBy,
      pageSize: req.body.pageSize,
      pageToken: req.body.pageToken,
    });
  });

  app.post<{
    Params: { ontology: string };
    Body: {
      objectSet: Record<string, unknown>;
      aggregations: ObjectSetAggregation[];
    };
  }>('/api/v2/ontologies/:ontology/objectSets/aggregate', async (req) => {
    const data = await reads.aggregateObjectSet(principalOf(req), req.params.ontology, {
      objectSet: normalizeObjectSet(req.body.objectSet),
      aggregations: req.body.aggregations,
    });
    return { data };
  });

  app.post<{
    Params: { ontology: string };
    Body: { pattern: GraphPattern; limit?: number };
  }>('/api/v2/ontologies/:ontology/graphPatterns/execute', async (req) => {
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
      authorizer: ctx.authorizer,
      limit: req.body.limit,
    });
  });

  app.get<{ Params: { ontology: string } }>(
    '/api/v2/ontologies/:ontology/actionTypes',
    async (req, reply) => {
      const v = await ctx.ontology.getLatestVersion(req.params.ontology);
      if (!v) return reply.code(404).send({ error: 'ontology not found' });
      return { data: Object.values(v.actionTypes) };
    },
  );

  app.post<{
    Params: { ontology: string };
    Body: ActionTypeDef;
  }>('/api/v2/ontologies/:ontology/actionTypes', async (req, reply) => {
    await ctx.ontology.openDraft(req.params.ontology);
    await ctx.ontology.addActionType(req.params.ontology, req.body);
    await ctx.ontology.commit({ ontologyId: req.params.ontology, createdBy: principalOf(req) });
    ctx.actions.registerActionType(req.params.ontology, req.body);
    return reply.code(201).send(req.body);
  });

  app.post<{
    Params: { ontology: string; action: string };
    Body: { parameters: Record<string, unknown> };
  }>('/api/v2/ontologies/:ontology/actions/:action/validate', async (req) => {
    await ensureActionType(req.params.ontology, req.params.action);
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
    await ensureActionType(req.params.ontology, req.params.action);
    return ctx.actions.apply({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
      idempotencyKey: req.body.idempotencyKey,
      expectedObjectVersions: req.body.expectedObjectVersions,
    });
  });

  app.post<{
    Params: { ontology: string; action: string };
    Body: { parameters?: Record<string, unknown> };
  }>('/api/v2/ontologies/:ontology/actions/:action/parameter-tree', async (req) => {
    await ensureActionType(req.params.ontology, req.params.action);
    if (!ctx.actions.parameterTree) {
      throw new Error('parameterTree not supported');
    }
    return ctx.actions.parameterTree({
      ontologyId: req.params.ontology,
      actionApiName: req.params.action,
      parameters: req.body.parameters ?? {},
      principal: principalOf(req),
    });
  });

  app.post<{
    Params: { ontology: string; objectType: string; primaryKey: string };
    Body: { template: string };
  }>(
    '/api/v2/ontologies/:ontology/objects/:objectType/:primaryKey/render',
    async (req) => {
      const obj = await ctx.objects.get(
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
    async (req) => {
      const principal = principalOf(req);
      const authz = ctx.authorizer?.authorize({
        principal,
        resource: `action-execution:${req.params.id}`,
        operation: 'modify',
      }) ?? { decision: 'allow' as const, reason: 'default-allow', principalEpids: [], resourceEpid: null };
      if (authz.decision === 'deny') {
        throw new Error(authz.reason);
      }
      if (!ctx.actions.approve) throw new Error('approvals not supported');
      return ctx.actions.approve(req.params.id, principal);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v2/actions/executions/:id/reject',
    async (req) => {
      const principal = principalOf(req);
      const authz = ctx.authorizer?.authorize({
        principal,
        resource: `action-execution:${req.params.id}`,
        operation: 'modify',
      }) ?? { decision: 'allow' as const, reason: 'default-allow', principalEpids: [], resourceEpid: null };
      if (authz.decision === 'deny') {
        throw new Error(authz.reason);
      }
      if (!ctx.actions.reject) throw new Error('approvals not supported');
      return ctx.actions.reject(req.params.id, principal);
    },
  );

  app.get<{ Querystring: { q?: string; ontology?: string; limit?: string } }>(
    '/api/v2/catalog/search',
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
          if (ctx.authorizer && !ctx.authorizer.canReadObjectType(principal, objectTypeId)) {
            continue;
          }
          hits.push({
            urn: catalogHitUrn({
              ontology_id: String(row.ontology_id),
              object_type_id: objectTypeId,
              primary_key: String(row.primary_key),
            }),
            ontologyId: String(row.ontology_id),
            objectTypeId,
            primaryKey: String(row.primary_key),
            properties: (row.properties as Record<string, unknown>) ?? {},
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
            if (ctx.authorizer && !ctx.authorizer.canReadObjectType(principal, o.objectTypeId)) {
              continue;
            }
            const blob = JSON.stringify(o.properties).toLowerCase();
            if (!o.primaryKey.toLowerCase().includes(needle) && !blob.includes(needle)) continue;
            data.push({
              urn: urnOf(o.ontologyId, o.objectTypeId, o.primaryKey),
              ontologyId: o.ontologyId,
              objectTypeId: o.objectTypeId,
              primaryKey: o.primaryKey,
              properties: o.properties,
            });
          }
        }
      }
      return { data };
    },
  );

  app.post<{ Params: { connectorId: string }; Body: unknown }>(
    '/api/v2/ingest/:connectorId',
    async (req, reply) => {
      const secret = process.env.PLATFORM_INGEST_SECRET ?? '';
      const signature = String(
        (req.headers['x-neumann-signature'] as string | undefined) ?? '',
      );
      const raw = JSON.stringify(req.body ?? {});
      if (!secret || !signature || !hmacHexEqual(raw, secret, signature)) {
        return reply.code(401).send({ error: 'invalid webhook signature' });
      }
      return reply.code(202).send({ accepted: true, connectorId: req.params.connectorId });
    },
  );

  app.get('/api/v2/catalog/types', async () => {
    const ontologies = await ctx.ontology.listOntologies();
    const data = [];
    for (const o of ontologies) {
      const v = await ctx.ontology.getLatestVersion(o.id);
      const types = Object.values(v?.objectTypes ?? {});
      for (const t of types) {
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
