/**
 * knowledge-graph — src/core/store.ts
 * Graph facade over canonical ObjectRepository / LinkRepository.
 *
 * Ownership: tickets (remote refs) are process-local. Objects and links are not.
 * Identity: ontologyId + objectTypeId + primaryKey. GraphObject.id is a handle.
 */

import {
  assertTypedLink,
  canViewAtLevel,
  type GraphObject,
  type GraphObjectId,
  type IntegrityReport,
  type KnowledgeGraphStore,
  type LinkMigrationInput,
  type LinkMigrationResult,
  type LinkRecord,
  type ObjectRecord,
  type ObjectTypeId,
  type RemoteObjectRef,
  type TicketId,
  type TraverseHop,
  type TraverseQuery,
  type TraverseResult,
  type TypedLink,
} from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';

import type { CreateKnowledgeGraphOptions } from './types.js';

/** Default ontology namespace when the facade owns its memory adapters. */
export const KNOWLEDGE_GRAPH_ONTOLOGY_ID = 'graph';

function sqlQuote(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string');
  return out.length > 0 ? out : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function toGraphObject(rec: ObjectRecord): GraphObject {
  const p = rec.provenance ?? {};
  return Object.freeze({
    id: rec.id,
    objectTypeId: rec.objectTypeId,
    primaryKey: rec.primaryKey,
    properties: rec.properties ? Object.freeze({ ...rec.properties }) : undefined,
    deleted: rec.deleted,
    sourceSystem: asString(p.sourceSystem) ?? rec.source,
    classification: asString(p.classification),
    provenance: asStringArray(p.lineage),
    propertyClassifications: asStringRecord(p.propertyClassifications),
  });
}

function toTypedLink(link: LinkRecord, source: ObjectRecord, target: ObjectRecord): TypedLink {
  const p = link.provenance ?? {};
  const typed = Object.freeze({
    id: link.id,
    linkTypeId: link.linkTypeId,
    sourceObjectId: source.id,
    targetObjectId: target.id,
    mappingVersionId: asString(p.mappingVersionId) ?? '',
    datasetVersionId: asString(p.datasetVersionId),
    sourceDatasetId: asString(p.sourceDatasetId),
    targetDatasetId: asString(p.targetDatasetId),
  }) as TypedLink;
  assertTypedLink(typed);
  return typed;
}

/**
 * Knowledge graph as a read/write facade over the storage kernel.
 * Does not own object/link Maps.
 */
export function createKnowledgeGraph(
  opts: CreateKnowledgeGraphOptions = {},
): KnowledgeGraphStore {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const forbidSelfLoops = opts.forbidSelfLoops ?? true;
  const ontologyId = opts.ontologyId ?? KNOWLEDGE_GRAPH_ONTOLOGY_ID;
  const objects =
    opts.objects ?? createMemoryObjectRepository({ clock, nextId });
  const links =
    opts.links ??
    createMemoryLinkRepository({
      clock,
      nextId,
      objectExists: async (oid, typeId, pk) => Boolean(await objects.get(oid, typeId, pk)),
    });

  const tickets = new Map<TicketId, RemoteObjectRef>();
  const knownObjectTypeIds = new Set<string>(opts.objectTypeIds ?? []);

  function rememberType(typeId: string): void {
    knownObjectTypeIds.add(typeId);
  }

  async function requireObject(id: GraphObjectId): Promise<GraphObject> {
    const rec = await objects.getById(id);
    if (!rec || rec.deleted) throw new Error(`objeto inexistente ou deletado: ${id}`);
    rememberType(rec.objectTypeId);
    return toGraphObject(rec);
  }

  async function listKnownRecords(includeDeleted = false): Promise<ObjectRecord[]> {
    const out: ObjectRecord[] = [];
    for (const typeId of knownObjectTypeIds) {
      out.push(...(await objects.list(ontologyId, typeId, { includeDeleted })));
    }
    return out;
  }

  async function eachRawLink(
    visit: (link: LinkRecord, source?: ObjectRecord, target?: ObjectRecord) => void,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const rec of await listKnownRecords(true)) {
      const from = await links.listFrom(
        rec.ontologyId,
        rec.objectTypeId,
        rec.primaryKey,
        undefined,
        { includeDeletedEndpoints: true },
      );
      for (const link of from) {
        if (seen.has(link.id) || link.deleted) continue;
        seen.add(link.id);
        const source = await objects.get(
          link.ontologyId,
          link.sourceObjectTypeId,
          link.sourcePrimaryKey,
        );
        const target = await objects.get(
          link.ontologyId,
          link.targetObjectTypeId,
          link.targetPrimaryKey,
        );
        visit(link, source, target);
      }
    }
  }

  async function listAllTypedLinks(): Promise<TypedLink[]> {
    const out: TypedLink[] = [];
    await eachRawLink((link, source, target) => {
      if (!source || !target) return;
      out.push(toTypedLink(link, source, target));
    });
    return out;
  }

  return {
    async upsertObject(obj: GraphObject): Promise<void> {
      if (!obj.id) throw new Error('GraphObject: id obrigatório');
      if (!obj.objectTypeId) throw new Error('GraphObject: objectTypeId obrigatório');
      rememberType(obj.objectTypeId);
      const provenance = {
        sourceSystem: obj.sourceSystem,
        classification: obj.classification,
        lineage: obj.provenance,
        propertyClassifications: obj.propertyClassifications,
      };
      const existing =
        (await objects.get(ontologyId, obj.objectTypeId, obj.primaryKey)) ??
        (await objects.getById(obj.id));

      if (obj.deleted && existing) {
        await objects.delete(existing.ontologyId, existing.objectTypeId, existing.primaryKey);
        return;
      }

      if (existing) {
        await objects.update(existing.ontologyId, existing.objectTypeId, existing.primaryKey, {
          properties: obj.properties ?? {},
          mode: 'replace',
          provenance,
        });
        return;
      }

      await objects.create({
        id: obj.id,
        ontologyId,
        objectTypeId: obj.objectTypeId,
        primaryKey: obj.primaryKey,
        properties: obj.properties ?? {},
        source: obj.sourceSystem,
        provenance,
      });
    },

    async getObject(id) {
      const rec = await objects.getById(id);
      return rec ? toGraphObject(rec) : undefined;
    },

    async listObjects(objectTypeId?: ObjectTypeId) {
      if (objectTypeId) rememberType(objectTypeId);
      const records = objectTypeId
        ? await objects.list(ontologyId, objectTypeId)
        : await listKnownRecords();
      return records.filter((o) => !o.deleted).map(toGraphObject);
    },

    async upsertLink(input): Promise<TypedLink> {
      const source = await requireObject(input.sourceObjectId);
      const target = await requireObject(input.targetObjectId);
      if (forbidSelfLoops && input.sourceObjectId === input.targetObjectId) {
        throw new Error(`self-loop proibido: ${input.sourceObjectId}`);
      }
      const srcRec = await objects.getById(source.id);
      const tgtRec = await objects.getById(target.id);
      if (!srcRec || !tgtRec) {
        throw new Error(`objeto inexistente ou deletado: ${input.sourceObjectId}`);
      }
      const existing = (
        await links.listFrom(
          srcRec.ontologyId,
          srcRec.objectTypeId,
          srcRec.primaryKey,
          input.linkTypeId,
        )
      ).find((l) => l.targetPrimaryKey === tgtRec.primaryKey && !l.deleted);
      if (existing) {
        await links.delete(
          existing.ontologyId,
          existing.linkTypeId,
          existing.sourceObjectTypeId,
          existing.sourcePrimaryKey,
          existing.targetObjectTypeId,
          existing.targetPrimaryKey,
        );
      }
      const created = await links.create({
          id: input.id ?? existing?.id,
          ontologyId: srcRec.ontologyId,
          linkTypeId: input.linkTypeId,
          sourceObjectTypeId: srcRec.objectTypeId,
          sourcePrimaryKey: srcRec.primaryKey,
          targetObjectTypeId: tgtRec.objectTypeId,
          targetPrimaryKey: tgtRec.primaryKey,
        provenance: {
          mappingVersionId: input.mappingVersionId,
          datasetVersionId: input.datasetVersionId,
          sourceDatasetId: input.sourceDatasetId,
          targetDatasetId: input.targetDatasetId,
        },
      });
      return toTypedLink(created, srcRec, tgtRec);
    },

    async getLink(id) {
      return (await listAllTypedLinks()).find((l) => l.id === id);
    },

    async listLinks(filter) {
      const out: TypedLink[] = [];
      for (const l of await listAllTypedLinks()) {
        if (filter?.linkTypeId && l.linkTypeId !== filter.linkTypeId) continue;
        if (filter?.mappingVersionId && l.mappingVersionId !== filter.mappingVersionId) {
          continue;
        }
        out.push(l);
      }
      return out;
    },

    async checkIntegrity(): Promise<IntegrityReport> {
      const issues: IntegrityReport['issues'] = [];
      const objectById: Map<string, GraphObject> = new Map();
      for (const o of await listKnownRecords()) {
        if (!o.deleted) objectById.set(o.id, toGraphObject(o));
      }
      let linkCount = 0;
      const seen = new Set<string>();
      await eachRawLink((link, source, target) => {
        linkCount += 1;
        const sourceId = source?.id ?? `${link.sourceObjectTypeId}:${link.sourcePrimaryKey}`;
        const targetId = target?.id ?? `${link.targetObjectTypeId}:${link.targetPrimaryKey}`;
        if (!source) {
          issues.push({
            kind: 'dangling_source',
            linkId: link.id,
            detail: `source ${sourceId} ausente`,
          });
        }
        if (!target) {
          issues.push({
            kind: 'dangling_target',
            linkId: link.id,
            detail: `target ${targetId} ausente`,
          });
        }
        if (forbidSelfLoops && source && target && source.id === target.id) {
          issues.push({
            kind: 'self_loop_forbidden',
            linkId: link.id,
            detail: 'self-loop',
          });
        }
        const k = `${link.linkTypeId}|${sourceId}|${targetId}`;
        if (seen.has(k)) {
          issues.push({ kind: 'duplicate', linkId: link.id, detail: k });
        }
        seen.add(k);
      });
      return {
        ok: issues.length === 0,
        linkCount,
        objectCount: objectById.size,
        issues,
      };
    },

    async traverseLinks(query: TraverseQuery): Promise<TraverseResult> {
      const maxHops = Math.max(0, query.maxHops);
      const direction = query.direction ?? 'outgoing';
      const unique = query.uniqueNodes ?? true;
      const typeFilter = query.linkTypeIds ? new Set(query.linkTypeIds) : null;
      const allLinks = await listAllTypedLinks();
      const objectById: Map<string, GraphObject> = new Map();
      for (const o of await listKnownRecords()) {
        if (!o.deleted) objectById.set(o.id, toGraphObject(o));
      }

      const start = objectById.get(query.startObjectId);
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
      const nodeMap: Map<string, GraphObject> = new Map();
      nodeMap.set(start.id, start);

      const visited = new Set<GraphObjectId>([start.id]);
      let frontier: GraphObjectId[] = [start.id];
      let depth = 0;
      let maxDepthReached = 0;

      while (frontier.length > 0 && depth < maxHops) {
        depth += 1;
        const next: GraphObjectId[] = [];
        for (const fromId of frontier) {
          for (const link of allLinks) {
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

            const to = objectById.get(toId);
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

      return `-- kernel-equivalent Postgres recursive CTE
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

    async migrateLinks(input: LinkMigrationInput): Promise<LinkMigrationResult> {
      const migrationId = nextId('lmig');
      const typeMap = input.linkTypeMap ?? {};
      let migrated = 0;
      let dropped = 0;
      let skipped = 0;

      const oldLinks = (await listAllTypedLinks()).filter(
        (l) => l.mappingVersionId === input.fromMappingVersionId,
      );

      for (const old of oldLinks) {
        const newType = typeMap[old.linkTypeId] ?? old.linkTypeId;
        let source: GraphObject;
        let target: GraphObject;
        try {
          source = await requireObject(old.sourceObjectId);
          target = await requireObject(old.targetObjectId);
        } catch {
          skipped += 1;
          continue;
        }
        const srcRec = await objects.getById(source.id);
        const tgtRec = await objects.getById(target.id);
        if (!srcRec || !tgtRec) {
          skipped += 1;
          continue;
        }
        await links.delete(
          srcRec.ontologyId,
          old.linkTypeId,
          srcRec.objectTypeId,
          srcRec.primaryKey,
          tgtRec.objectTypeId,
          tgtRec.primaryKey,
        );
        await links.create({
          ontologyId: srcRec.ontologyId,
          linkTypeId: newType,
          sourceObjectTypeId: srcRec.objectTypeId,
          sourcePrimaryKey: srcRec.primaryKey,
          targetObjectTypeId: tgtRec.objectTypeId,
          targetPrimaryKey: tgtRec.primaryKey,
          provenance: {
            mappingVersionId: input.toMappingVersionId,
            datasetVersionId: old.datasetVersionId,
            sourceDatasetId: old.sourceDatasetId,
            targetDatasetId: old.targetDatasetId,
          },
        });
        migrated += 1;
        dropped += 1;
      }

      return { migrationId, migrated, dropped, skipped };
    },

    async createRemoteReference(objectId: GraphObjectId): Promise<RemoteObjectRef> {
      const obj = await requireObject(objectId);
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

    async resolveRemoteReference(ticketId: TicketId) {
      const ref = tickets.get(ticketId);
      if (!ref) return null;
      const rec = await objects.getById(ref.objectId);
      if (!rec || rec.deleted) return null;
      return toGraphObject(rec);
    },

    async accessRemote(ticketId: TicketId, property: string): Promise<unknown> {
      const obj = await this.resolveRemoteReference(ticketId);
      if (!obj) return null;
      if (property === 'id') return obj.id;
      if (property === 'objectTypeId') return obj.objectTypeId;
      if (property === 'primaryKey') return obj.primaryKey;
      return obj.properties?.[property] ?? null;
    },
  };
}
