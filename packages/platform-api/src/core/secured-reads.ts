/**
 * platform-api — src/core/secured-reads.ts
 *
 * Unique HTTP read surface: ObjectSets / history / links / aggregates
 * go through ctx.policy. Raw writers stay on PlatformContext for Actions + ProjectionWriter.
 */

import type { ObjectRecord, ObjectSet, ObjectSetAggregation } from 'contracts';
import {
  aggregateRecords,
  coerceObjectSet,
  loadObjects,
  loadObjectsPg,
  propertyLookupFromOntology,
  resolveObjectSet,
} from 'object-set';

import type { PublicPlatformContext } from './context.js';

export class ReadForbiddenError extends Error {
  readonly errorCode = 'READ_FORBIDDEN';
  readonly errorName = 'ObjectTypeReadDenied';
  constructor(
    readonly principal: string,
    readonly objectTypeId: string,
  ) {
    super(`principal "${principal}" cannot read object type "${objectTypeId}"`);
    this.name = 'ReadForbiddenError';
  }
}

function collectDeclaredTypes(set: ObjectSet): string[] {
  switch (set.type) {
    case 'BASE':
    case 'STATIC':
      return [set.objectType];
    case 'FILTER':
    case 'SEARCH_AROUND':
      return collectDeclaredTypes(set.objectSet);
    case 'UNION':
    case 'INTERSECT':
      return set.objectSets.flatMap(collectDeclaredTypes);
    case 'SUBTRACT':
      return set.objectSets.flatMap(collectDeclaredTypes);
    default:
      return [];
  }
}

export function createSecuredReads(ctx: PublicPlatformContext) {
  function policy() {
    return ctx.policy;
  }

  function canRead(principal: string, ontologyId: string, objectTypeId: string): boolean {
    return policy().canReadObjectType(principal, objectTypeId, ontologyId);
  }

  function redact(principal: string, rec: ObjectRecord): ObjectRecord {
    const authz = policy();
    return {
      ...rec,
      properties: authz.redactProperties(
        principal,
        rec.objectTypeId,
        rec.properties,
        rec.ontologyId,
      ) as Record<string, unknown>,
    };
  }

  function filterAndRedact(principal: string, records: readonly ObjectRecord[]): ObjectRecord[] {
    const visible = policy().filterReadable(principal, records);
    return visible.map((r) => redact(principal, r));
  }

  return {
    canRead,
    redact,
    filterAndRedact,

    async getObject(principal: string, ontologyId: string, objectTypeId: string, primaryKey: string) {
      if (!canRead(principal, ontologyId, objectTypeId)) return undefined;
      const obj = await ctx.objects.get(ontologyId, objectTypeId, primaryKey);
      return obj ? redact(principal, obj) : undefined;
    },

    async listObjects(principal: string, ontologyId: string, objectTypeId: string) {
      if (!canRead(principal, ontologyId, objectTypeId)) return [];
      const listed = await ctx.objects.list(ontologyId, objectTypeId);
      return listed.map((o) => redact(principal, o));
    },

    async listHistory(principal: string, objectId: string) {
      const trail = await ctx.history.listByObject(objectId);
      if (trail.length === 0) return [];
      const objectTypeId = trail[0]!.objectTypeId;
      const ontologyId = trail[0]!.ontologyId;
      if (!canRead(principal, ontologyId, objectTypeId)) return [];
      return trail.map((entry) => ({
        ...entry,
        properties: policy().redactProperties(
          principal,
          objectTypeId,
          entry.properties,
          ontologyId,
        ) as Record<string, unknown>,
      }));
    },

    async listLinkTargets(
      principal: string,
      ontologyId: string,
      sourceObjectTypeId: string,
      sourcePrimaryKey: string,
      linkTypeId: string,
    ) {
      if (!canRead(principal, ontologyId, sourceObjectTypeId)) return [];
      const latest = await ctx.ontology.getLatestVersion(ontologyId);
      const targetType = latest?.linkTypes[linkTypeId]?.targetObjectTypeId;
      if (targetType && !canRead(principal, ontologyId, targetType)) return [];

      const edges = await ctx.links.listFrom(
        ontologyId,
        sourceObjectTypeId,
        sourcePrimaryKey,
        linkTypeId,
      );
      const data: ObjectRecord[] = [];
      for (const e of edges) {
        if (!canRead(principal, ontologyId, e.targetObjectTypeId)) continue;
        const t = await ctx.objects.get(ontologyId, e.targetObjectTypeId, e.targetPrimaryKey);
        if (t) data.push(redact(principal, t));
      }
      return data;
    },

    async loadObjectSet(
      principal: string,
      ontologyId: string,
      req: Parameters<typeof loadObjects>[0],
    ) {
      const denied = collectDeclaredTypes(req.objectSet).some(
        (t) => !canRead(principal, ontologyId, t),
      );
      if (denied) return { data: [] as ObjectRecord[] };
      const latest = await ctx.ontology.getLatestVersion(ontologyId);
      const lookup = propertyLookupFromOntology(latest);
      const objectSet = latest
        ? coerceObjectSet(req.objectSet, lookup, 'strict')
        : req.objectSet;
      const loaded = ctx.sql
        ? await loadObjectsPg(
            { ...req, objectSet },
            { sql: ctx.sql, ontologyId, propertyTypes: lookup },
          )
        : await loadObjects(
            { ...req, objectSet },
            { ontologyId, objects: ctx.objects, links: ctx.links, propertyTypes: lookup },
          );
      return { ...loaded, data: filterAndRedact(principal, loaded.data) };
    },

    async aggregateObjectSet(
      principal: string,
      ontologyId: string,
      req: { objectSet: ObjectSet; aggregations: ObjectSetAggregation[] },
    ) {
      const denied = collectDeclaredTypes(req.objectSet).some(
        (t) => !canRead(principal, ontologyId, t),
      );
      if (denied) return aggregateRecords([], req.aggregations);
      const latest = await ctx.ontology.getLatestVersion(ontologyId);
      const lookup = propertyLookupFromOntology(latest);
      const objectSet = latest
        ? coerceObjectSet(req.objectSet, lookup, 'strict')
        : req.objectSet;
      const objs = await resolveObjectSet(objectSet, {
        ontologyId,
        objects: ctx.objects,
        links: ctx.links,
        propertyTypes: lookup,
      });
      // WHY: redaction must precede aggregate; SQL count over raw rows would leak hidden fields.
      const visible = filterAndRedact(principal, objs);
      return aggregateRecords(visible, req.aggregations);
    },
  };
}
