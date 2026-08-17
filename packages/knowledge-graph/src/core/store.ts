/**
 * knowledge-graph — src/core/store.ts
 * Grafo vivo Object→Link→Object + multi-hop + remote refs + link migration.
 *
 * US20250077899A1 / US 9,378,526 / US 9,621,676 / US 9,906,623
 */

import {
  assertTypedLink,
  canViewAtLevel,
  type GraphObject,
  type GraphObjectId,
  type IntegrityReport,
  type KnowledgeGraphStore,
  type LinkInstanceId,
  type LinkMigrationInput,
  type LinkMigrationResult,
  type ObjectTypeId,
  type RemoteObjectRef,
  type TicketId,
  type TraverseHop,
  type TraverseQuery,
  type TraverseResult,
  type TypedLink,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import type { CreateKnowledgeGraphOptions } from './types.js';

function linkKey(l: Pick<TypedLink, 'linkTypeId' | 'sourceObjectId' | 'targetObjectId'>): string {
  return `${l.linkTypeId}|${l.sourceObjectId}|${l.targetObjectId}`;
}

function sqlQuote(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

export function createKnowledgeGraph(
  opts: CreateKnowledgeGraphOptions = {},
): KnowledgeGraphStore {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const forbidSelfLoops = opts.forbidSelfLoops ?? true;

  const objects = new Map<GraphObjectId, GraphObject>();
  const links = new Map<LinkInstanceId, TypedLink>();
  const byKey = new Map<string, LinkInstanceId>();
  const tickets = new Map<TicketId, RemoteObjectRef>();

  function requireObject(id: GraphObjectId): GraphObject {
    const o = objects.get(id);
    if (!o || o.deleted) throw new Error(`objeto inexistente ou deletado: ${id}`);
    return o;
  }

  return {
    upsertObject(obj: GraphObject): void {
      if (!obj.id) throw new Error('GraphObject: id obrigatório');
      if (!obj.objectTypeId) throw new Error('GraphObject: objectTypeId obrigatório');
      objects.set(
        obj.id,
        Object.freeze({
          id: obj.id,
          objectTypeId: obj.objectTypeId,
          primaryKey: obj.primaryKey,
          properties: obj.properties ? Object.freeze({ ...obj.properties }) : undefined,
          deleted: obj.deleted ?? false,
          sourceSystem: obj.sourceSystem,
          classification: obj.classification,
          provenance: obj.provenance ? [...obj.provenance] : undefined,
          propertyClassifications: obj.propertyClassifications
            ? { ...obj.propertyClassifications }
            : undefined,
        }),
      );
    },

    getObject(id) {
      return objects.get(id);
    },

    listObjects(objectTypeId?: ObjectTypeId) {
      const out: GraphObject[] = [];
      for (const o of objects.values()) {
        if (o.deleted) continue;
        if (objectTypeId && o.objectTypeId !== objectTypeId) continue;
        out.push(o);
      }
      return out;
    },

    upsertLink(input): TypedLink {
      const source = requireObject(input.sourceObjectId);
      const target = requireObject(input.targetObjectId);
      if (forbidSelfLoops && input.sourceObjectId === input.targetObjectId) {
        throw new Error(`self-loop proibido: ${input.sourceObjectId}`);
      }
      const key = linkKey(input);
      const existingId = byKey.get(key);
      const id = input.id ?? existingId ?? nextId('link');
      if (existingId && existingId !== id && links.has(existingId)) {
        links.delete(existingId);
      }
      const link = Object.freeze({
        id,
        linkTypeId: input.linkTypeId,
        sourceObjectId: source.id,
        targetObjectId: target.id,
        mappingVersionId: input.mappingVersionId,
        datasetVersionId: input.datasetVersionId,
        sourceDatasetId: input.sourceDatasetId,
        targetDatasetId: input.targetDatasetId,
      }) as TypedLink;
      assertTypedLink(link);
      links.set(id, link);
      byKey.set(key, id);
      return link;
    },

    getLink(id) {
      return links.get(id);
    },

    listLinks(filter) {
      const out: TypedLink[] = [];
      for (const l of links.values()) {
        if (filter?.linkTypeId && l.linkTypeId !== filter.linkTypeId) continue;
        if (filter?.mappingVersionId && l.mappingVersionId !== filter.mappingVersionId) {
          continue;
        }
        out.push(l);
      }
      return out;
    },

    checkIntegrity(): IntegrityReport {
      const issues: IntegrityReport['issues'] = [];
      const seen = new Set<string>();
      for (const l of links.values()) {
        if (!objects.has(l.sourceObjectId) || objects.get(l.sourceObjectId)?.deleted) {
          issues.push({
            kind: 'dangling_source',
            linkId: l.id,
            detail: `source ${l.sourceObjectId} ausente`,
          });
        }
        if (!objects.has(l.targetObjectId) || objects.get(l.targetObjectId)?.deleted) {
          issues.push({
            kind: 'dangling_target',
            linkId: l.id,
            detail: `target ${l.targetObjectId} ausente`,
          });
        }
        if (forbidSelfLoops && l.sourceObjectId === l.targetObjectId) {
          issues.push({
            kind: 'self_loop_forbidden',
            linkId: l.id,
            detail: 'self-loop',
          });
        }
        const k = linkKey(l);
        if (seen.has(k)) {
          issues.push({ kind: 'duplicate', linkId: l.id, detail: k });
        }
        seen.add(k);
      }
      return {
        ok: issues.length === 0,
        linkCount: links.size,
        objectCount: [...objects.values()].filter((o) => !o.deleted).length,
        issues,
      };
    },

    traverseLinks(query: TraverseQuery): TraverseResult {
      const maxHops = Math.max(0, query.maxHops);
      const direction = query.direction ?? 'outgoing';
      const unique = query.uniqueNodes ?? true;
      const typeFilter = query.linkTypeIds ? new Set(query.linkTypeIds) : null;

      const start = objects.get(query.startObjectId);
      if (!start || start.deleted) {
        return {
          startObjectId: query.startObjectId,
          nodes: [],
          hops: [],
          maxDepthReached: 0,
        };
      }
      if (query.viewingLevel && !canViewAtLevel(start.classification, query.viewingLevel)) {
        return {
          startObjectId: query.startObjectId,
          nodes: [],
          hops: [],
          maxDepthReached: 0,
        };
      }

      const hops: TraverseHop[] = [];
      const nodeMap = new Map<GraphObjectId, GraphObject>();
      nodeMap.set(start.id, start);

      const visited = new Set<GraphObjectId>([start.id]);
      let frontier: GraphObjectId[] = [start.id];
      let depth = 0;
      let maxDepthReached = 0;

      while (frontier.length > 0 && depth < maxHops) {
        depth += 1;
        const next: GraphObjectId[] = [];
        for (const fromId of frontier) {
          for (const link of links.values()) {
            if (typeFilter && !typeFilter.has(link.linkTypeId)) continue;

            let toId: GraphObjectId | null = null;
            if (
              (direction === 'outgoing' || direction === 'both') &&
              link.sourceObjectId === fromId
            ) {
              toId = link.targetObjectId;
            } else if (
              (direction === 'incoming' || direction === 'both') &&
              link.targetObjectId === fromId
            ) {
              toId = link.sourceObjectId;
            }
            if (!toId) continue;
            if (unique && visited.has(toId)) continue;

            const to = objects.get(toId);
            if (!to || to.deleted) continue;
            if (query.viewingLevel && !canViewAtLevel(to.classification, query.viewingLevel)) {
              continue;
            }

            hops.push({
              depth,
              viaLinkId: link.id,
              viaLinkTypeId: link.linkTypeId,
              fromObjectId: fromId,
              toObjectId: toId,
            });
            nodeMap.set(toId, to);
            visited.add(toId);
            next.push(toId);
            maxDepthReached = depth;
          }
        }
        frontier = next;
      }

      return {
        startObjectId: start.id,
        nodes: [...nodeMap.values()],
        hops,
        maxDepthReached,
      };
    },

    toRecursiveCteSql(query: TraverseQuery): string {
      const maxHops = Math.max(0, query.maxHops);
      const direction = query.direction ?? 'outgoing';
      const types = query.linkTypeIds;
      const typePred = types?.length
        ? `AND l.link_type_id IN (${types.map(sqlQuote).join(', ')})`
        : '';

      let edgeJoin: string;
      if (direction === 'outgoing') {
        edgeJoin = 'l.source_object_id = t.object_id';
        // expand to target
      } else if (direction === 'incoming') {
        edgeJoin = 'l.target_object_id = t.object_id';
      } else {
        edgeJoin =
          '(l.source_object_id = t.object_id OR l.target_object_id = t.object_id)';
      }

      const nextObjectExpr =
        direction === 'outgoing'
          ? 'l.target_object_id'
          : direction === 'incoming'
            ? 'l.source_object_id'
            : `CASE WHEN l.source_object_id = t.object_id THEN l.target_object_id ELSE l.source_object_id END`;

      return `-- kernel-equivalent Postgres recursive CTE (Passo 19)
WITH RECURSIVE traverse(object_id, depth, via_link_id, via_link_type_id, from_object_id) AS (
  SELECT ${sqlQuote(query.startObjectId)}::text, 0, NULL::text, NULL::text, NULL::text
  UNION ALL
  SELECT
    ${nextObjectExpr} AS object_id,
    t.depth + 1,
    l.id,
    l.link_type_id,
    t.object_id
  FROM traverse t
  JOIN links l ON ${edgeJoin}
  WHERE t.depth < ${maxHops}
    ${typePred}
)
SELECT * FROM traverse WHERE depth > 0 ORDER BY depth, object_id;`;
    },

    migrateLinks(input: LinkMigrationInput): LinkMigrationResult {
      const migrationId = nextId('lmig');
      const typeMap = input.linkTypeMap ?? {};
      let migrated = 0;
      let dropped = 0;
      let skipped = 0;

      const oldLinks = [...links.values()].filter(
        (l) => l.mappingVersionId === input.fromMappingVersionId,
      );

      for (const old of oldLinks) {
        const newType = typeMap[old.linkTypeId] ?? old.linkTypeId;
        try {
          requireObject(old.sourceObjectId);
          requireObject(old.targetObjectId);
        } catch {
          skipped += 1;
          continue;
        }

        // Remove old key before upsert with new mapping version.
        byKey.delete(linkKey(old));
        links.delete(old.id);

        const next: TypedLink = Object.freeze({
          ...old,
          id: nextId('link'),
          linkTypeId: newType,
          mappingVersionId: input.toMappingVersionId,
        });
        assertTypedLink(next);
        links.set(next.id, next);
        byKey.set(linkKey(next), next.id);
        migrated += 1;
        if (input.dropOld) dropped += 1;
        else dropped += 1; // old already removed as part of migration rewrite
      }

      return { migrationId, migrated, dropped, skipped };
    },

    createRemoteReference(objectId: GraphObjectId): RemoteObjectRef {
      const obj = requireObject(objectId);
      const ticketId = nextId('tkt');
      const ref: RemoteObjectRef = Object.freeze({
        ticketId,
        objectId: obj.id,
        objectTypeId: obj.objectTypeId,
        createdAt: clock(),
      });
      tickets.set(ticketId, ref);
      return ref;
    },

    resolveRemoteReference(ticketId: TicketId) {
      const ref = tickets.get(ticketId);
      if (!ref) return null;
      const obj = objects.get(ref.objectId);
      if (!obj || obj.deleted) return null;
      return obj;
    },

    accessRemote(ticketId: TicketId, property: string): unknown {
      const obj = this.resolveRemoteReference(ticketId);
      if (!obj) return null;
      if (property === 'id') return obj.id;
      if (property === 'objectTypeId') return obj.objectTypeId;
      if (property === 'primaryKey') return obj.primaryKey;
      return obj.properties?.[property] ?? null;
    },
  };
}
