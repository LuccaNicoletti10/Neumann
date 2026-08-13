/**
 * platform-api — src/core/secured-reads.ts
 *
 * Unique HTTP read surface: ObjectSets / history / links / aggregates
 * go through OntologyAuthorizer when present. Raw ctx.objects stays
 * unredacted for Actions + projector.
 */

import type { ObjectRecord, ObjectSet, ObjectSetAggregation } from 'contracts';
import { aggregateRecords, loadObjects, resolveObjectSet } from 'object-set';

import type { PlatformContext } from './context.js';

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

export function createSecuredReads(ctx: PlatformContext) {
  function canRead(principal: string, objectTypeId: string): boolean {
    if (!ctx.authorizer) return true;
    return ctx.authorizer.canReadObjectType(principal, objectTypeId);
  }

  function assertCanRead(principal: string, objectTypeId: string): void {
    if (!canRead(principal, objectTypeId)) {
      throw new ReadForbiddenError(principal, objectTypeId);
    }
  }

  function redact(principal: string, rec: ObjectRecord): ObjectRecord {
    if (!ctx.authorizer) return rec;
    return {
      ...rec,
      properties: ctx.authorizer.redactProperties(principal, rec.objectTypeId, rec.properties) as Record<
        string,
        unknown
      >,
    };
  }

  function filterAndRedact(principal: string, records: readonly ObjectRecord[]): ObjectRecord[] {
    const visible = ctx.authorizer ? ctx.authorizer.filterReadable(principal, records) : [...records];
    return visible.map((r) => redact(principal, r));
  }

  function assertDeclaredTypes(principal: string, objectSet: ObjectSet): void {
    for (const typeId of collectDeclaredTypes(objectSet)) {
      assertCanRead(principal, typeId);
    }
  }

  return {
    assertCanRead,
    redact,
    filterAndRedact,

    async getObject(principal: string, ontologyId: string, objectTypeId: string, primaryKey: string) {
      assertCanRead(principal, objectTypeId);
      const obj = await ctx.objects.get(ontologyId, objectTypeId, primaryKey);
      return obj ? redact(principal, obj) : undefined;
    },

    async listObjects(principal: string, ontologyId: string, objectTypeId: string) {
      assertCanRead(principal, objectTypeId);
      const listed = await ctx.objects.list(ontologyId, objectTypeId);
      return listed.map((o) => redact(principal, o));
    },

    async listHistory(principal: string, objectId: string) {
      const trail = await ctx.history.listByObject(objectId);
      if (trail.length === 0) return [];
      const objectTypeId = trail[0]!.objectTypeId;
      assertCanRead(principal, objectTypeId);
      return trail.map((entry) => ({
        ...entry,
        properties: ctx.authorizer
          ? (ctx.authorizer.redactProperties(principal, objectTypeId, entry.properties) as Record<
              string,
              unknown
            >)
          : entry.properties,
      }));
    },

    async listLinkTargets(
      principal: string,
      ontologyId: string,
      sourceObjectTypeId: string,
      sourcePrimaryKey: string,
      linkTypeId: string,
    ) {
      assertCanRead(principal, sourceObjectTypeId);
      const latest = await ctx.ontology.getLatestVersion(ontologyId);
      const targetType = latest?.linkTypes[linkTypeId]?.targetObjectTypeId;
      if (targetType) assertCanRead(principal, targetType);

      const edges = await ctx.links.listFrom(
        ontologyId,
        sourceObjectTypeId,
        sourcePrimaryKey,
        linkTypeId,
      );
      const data: ObjectRecord[] = [];
      for (const e of edges) {
        if (!canRead(principal, e.targetObjectTypeId)) continue;
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
      assertDeclaredTypes(principal, req.objectSet);
      const loaded = await loadObjects(req, {
        ontologyId,
        objects: ctx.objects,
        links: ctx.links,
      });
      return { ...loaded, data: filterAndRedact(principal, loaded.data) };
    },

    async aggregateObjectSet(
      principal: string,
      ontologyId: string,
      req: { objectSet: ObjectSet; aggregations: ObjectSetAggregation[] },
    ) {
      assertDeclaredTypes(principal, req.objectSet);
      const objs = await resolveObjectSet(req.objectSet, {
        ontologyId,
        objects: ctx.objects,
        links: ctx.links,
      });
      const visible = ctx.authorizer ? ctx.authorizer.filterReadable(principal, objs) : objs;
      return aggregateRecords(visible, req.aggregations);
    },
  };
}
