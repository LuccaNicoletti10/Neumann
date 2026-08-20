/**
 * knowledge-graph — src/core/graph-query.ts
 * GraphQueryEngine over canonical ObjectRepository + LinkRepository.
 * Does NOT own object/link state (P0 / P10).
 */

import type {
  GraphObject,
  IntegrityIssue,
  IntegrityReport,
  LinkRepository,
  ObjectRecord,
  ObjectRepository,
  OntologyId,
  TraverseDirection,
  TraverseHop,
  TraverseQuery,
  TraverseResult,
} from 'contracts';

export interface GraphQueryEngine {
  neighbors(
    ontologyId: OntologyId,
    objectTypeId: string,
    primaryKey: string,
    opts?: {
      linkTypeId?: string;
      linkTypeIds?: string[];
      direction?: TraverseDirection;
    },
  ): Promise<ObjectRecord[]>;
  searchAround(
    ontologyId: OntologyId,
    sources: ObjectRecord[],
    linkTypeId: string,
    direction?: TraverseDirection,
  ): Promise<ObjectRecord[]>;
  traverse(ontologyId: OntologyId, query: TraverseQuery & {
    startObjectTypeId: string;
    startPrimaryKey: string;
  }): Promise<TraverseResult>;
  checkIntegrity(ontologyId: OntologyId): Promise<IntegrityReport>;
}

export interface CreateGraphQueryEngineOptions {
  objects: ObjectRepository;
  links: LinkRepository;
}

function toGraphObject(o: ObjectRecord): GraphObject {
  return {
    id: o.id,
    objectTypeId: o.objectTypeId,
    primaryKey: o.primaryKey,
    properties: o.properties,
    deleted: o.deleted,
  };
}

export function createGraphQueryEngine(
  opts: CreateGraphQueryEngineOptions,
): GraphQueryEngine {
  const { objects, links } = opts;

  return {
    async neighbors(ontologyId, objectTypeId, primaryKey, o = {}) {
      const direction = o.direction ?? 'outgoing';
      const out: ObjectRecord[] = [];
      const seen = new Set<string>();
      const allowedTypes =
        o.linkTypeIds && o.linkTypeIds.length > 0
          ? new Set(o.linkTypeIds)
          : o.linkTypeId
            ? new Set([o.linkTypeId])
            : undefined;

      async function pushNeighbor(
        edgeLinkTypeId: string,
        neighborTypeId: string,
        neighborPk: string,
      ): Promise<void> {
        if (allowedTypes && !allowedTypes.has(edgeLinkTypeId)) return;
        const t = await objects.get(ontologyId, neighborTypeId, neighborPk);
        if (!t) return;
        const k = `${t.objectTypeId}::${t.primaryKey}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push(t);
      }

      if (direction === 'outgoing' || direction === 'both') {
        for (const edge of await links.listFrom(ontologyId, objectTypeId, primaryKey)) {
          await pushNeighbor(edge.linkTypeId, edge.targetObjectTypeId, edge.targetPrimaryKey);
        }
      }
      if (direction === 'incoming' || direction === 'both') {
        for (const edge of await links.listTo(ontologyId, objectTypeId, primaryKey)) {
          await pushNeighbor(edge.linkTypeId, edge.sourceObjectTypeId, edge.sourcePrimaryKey);
        }
      }
      return out;
    },

    async searchAround(ontologyId, sources, linkTypeId, direction = 'outgoing') {
      const seen = new Set<string>();
      const out: ObjectRecord[] = [];
      for (const src of sources) {
        const neighbors = await this.neighbors(
          ontologyId,
          src.objectTypeId,
          src.primaryKey,
          { linkTypeId, direction },
        );
        for (const n of neighbors) {
          const k = `${n.objectTypeId}::${n.primaryKey}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(n);
        }
      }
      return out;
    },

    async traverse(ontologyId, query) {
      const direction = query.direction ?? 'outgoing';
      const unique = query.uniqueNodes !== false;
      const start = await objects.get(
        ontologyId,
        query.startObjectTypeId,
        query.startPrimaryKey,
      );
      if (!start) {
        return {
          startObjectId: query.startObjectId,
          nodes: [],
          hops: [],
          maxDepthReached: 0,
        };
      }

      const nodes = new Map<string, GraphObject>();
      nodes.set(start.id, toGraphObject(start));
      const hops: TraverseHop[] = [];
      let frontier: ObjectRecord[] = [start];
      let depth = 0;
      let maxDepthReached = 0;

      while (frontier.length > 0 && depth < query.maxHops) {
        depth += 1;
        const next: ObjectRecord[] = [];
        for (const from of frontier) {
          const neighbors = await this.neighbors(
            ontologyId,
            from.objectTypeId,
            from.primaryKey,
            {
              linkTypeId: query.linkTypeIds?.[0],
              direction,
            },
          );
          // If multiple linkTypeIds, filter via listFrom/listTo manually
          let filtered = neighbors;
          if (query.linkTypeIds && query.linkTypeIds.length > 0) {
            const allowed = new Set(query.linkTypeIds);
            const edgesOut =
              direction === 'incoming'
                ? []
                : await links.listFrom(ontologyId, from.objectTypeId, from.primaryKey);
            const edgesIn =
              direction === 'outgoing'
                ? []
                : await links.listTo(ontologyId, from.objectTypeId, from.primaryKey);
            const edgeTargets = new Map<string, string>();
            for (const e of [...edgesOut, ...edgesIn]) {
              if (!allowed.has(e.linkTypeId)) continue;
              const isOut = e.sourceObjectTypeId === from.objectTypeId
                && e.sourcePrimaryKey === from.primaryKey;
              const ot = isOut ? e.targetObjectTypeId : e.sourceObjectTypeId;
              const pk = isOut ? e.targetPrimaryKey : e.sourcePrimaryKey;
              edgeTargets.set(`${ot}::${pk}`, e.id);
            }
            filtered = neighbors.filter((n) => edgeTargets.has(`${n.objectTypeId}::${n.primaryKey}`));
            for (const n of filtered) {
              const via = edgeTargets.get(`${n.objectTypeId}::${n.primaryKey}`)!;
              const viaType =
                [...edgesOut, ...edgesIn].find((e) => e.id === via)?.linkTypeId ??
                query.linkTypeIds[0]!;
              hops.push({
                depth,
                viaLinkId: via,
                viaLinkTypeId: viaType,
                fromObjectId: from.id,
                toObjectId: n.id,
              });
              if (unique && nodes.has(n.id)) continue;
              nodes.set(n.id, toGraphObject(n));
              next.push(n);
            }
            continue;
          }

          for (const n of filtered) {
            hops.push({
              depth,
              viaLinkId: `${from.id}->${n.id}`,
              viaLinkTypeId: '*',
              fromObjectId: from.id,
              toObjectId: n.id,
            });
            if (unique && nodes.has(n.id)) continue;
            nodes.set(n.id, toGraphObject(n));
            next.push(n);
          }
        }
        frontier = next;
        if (next.length) maxDepthReached = depth;
      }

      return {
        startObjectId: start.id,
        nodes: [...nodes.values()],
        hops,
        maxDepthReached,
      };
    },

    async checkIntegrity(ontologyId) {
      const issues: IntegrityIssue[] = [];
      const allObjects = await objects.listAll(ontologyId, { includeDeleted: true });
      const liveObjects = allObjects.filter((o) => !o.deleted);
      const liveKeys = new Set(liveObjects.map((o) => `${o.objectTypeId}::${o.primaryKey}`));
      const allLinks = await links.listAll(ontologyId, {
        includeDeletedLinks: true,
        includeDeletedEndpoints: true,
      });
      const liveLinks = allLinks.filter((l) => !l.deleted);
      const seen = new Set<string>();
      for (const link of liveLinks) {
        const dupKey = [
          link.linkTypeId,
          link.sourceObjectTypeId,
          link.sourcePrimaryKey,
          link.targetObjectTypeId,
          link.targetPrimaryKey,
        ].join('|');
        if (seen.has(dupKey)) {
          issues.push({ kind: 'duplicate', linkId: link.id, detail: dupKey });
        }
        seen.add(dupKey);
        const src = `${link.sourceObjectTypeId}::${link.sourcePrimaryKey}`;
        const tgt = `${link.targetObjectTypeId}::${link.targetPrimaryKey}`;
        if (!liveKeys.has(src)) {
          issues.push({
            kind: 'dangling_source',
            linkId: link.id,
            detail: src,
          });
        }
        if (!liveKeys.has(tgt)) {
          issues.push({
            kind: 'dangling_target',
            linkId: link.id,
            detail: tgt,
          });
        }
      }
      return {
        ok: issues.length === 0,
        linkCount: liveLinks.length,
        objectCount: liveObjects.length,
        issues,
      };
    },
  };
}
