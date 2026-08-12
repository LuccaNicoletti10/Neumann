/**
 * object-platform — src/core/platform.ts
 * Mapping versionado + projetor + Object API (Passo 18).
 *
 * US 8,930,897 / US 10,691,729 / EP3425537A1 / US 11,816,156 / US 12,561,339
 */

import {
  assertMappingVersion,
  type AuthorizeFn,
  type CommitMappingInput,
  type CreateMappingInput,
  type DatasetObjectMapping,
  type DatasetRow,
  type LinkInstance,
  type MappingDraft,
  type MappingId,
  type MappingVersion,
  type MappingVersionId,
  type ObjectHistoryEntry,
  type ObjectPlatform,
  type ObjectProvenance,
  type ObjectQuery,
  type OntologyObject,
  type OntologyObjectId,
  type PrincipalId,
  type ProjectInput,
  type ProjectResult,
  type PropertyMapping,
  type PropertyTypeId,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { hashCanonical } from './hash.js';
import type { CreateObjectPlatformOptions } from './types.js';

const allowAll: AuthorizeFn = (req) => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: `default-allow ${req.operation}`,
});

function applyTransform(raw: unknown, mapping: PropertyMapping): unknown {
  const t = mapping.transform ?? 'identity';
  if (t === 'identity') return raw;
  if (t === 'string') return raw == null ? '' : String(raw);
  if (t === 'number') {
    if (typeof raw === 'number') return raw;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (t === 'boolean') return Boolean(raw);
  return raw;
}

function primaryKeyOf(row: DatasetRow, fields: string[]): string {
  return fields.map((f) => String(row.fields[f] ?? '')).join('|');
}

function objectResourceId(objectId: OntologyObjectId): string {
  return `object:${objectId}`;
}

function freezeObject(o: OntologyObject): OntologyObject {
  return Object.freeze({
    ...o,
    properties: Object.freeze({ ...o.properties }),
  });
}

function freezeHistory(h: ObjectHistoryEntry): ObjectHistoryEntry {
  return Object.freeze({
    ...h,
    properties: Object.freeze({ ...h.properties }),
  });
}

export function createObjectPlatform(opts: CreateObjectPlatformOptions = {}): ObjectPlatform {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const authorize: AuthorizeFn = opts.authorize ?? allowAll;

  const mappings = new Map<MappingId, DatasetObjectMapping>();
  const mappingVersions = new Map<MappingVersionId, MappingVersion>();
  const versionsByMapping = new Map<MappingId, MappingVersionId[]>();
  const drafts = new Map<MappingId, MappingDraft>();

  /** key = `${objectTypeId}::${primaryKey}` → objectId */
  const indexByPk = new Map<string, OntologyObjectId>();
  const objects = new Map<OntologyObjectId, OntologyObject>();
  const history = new Map<OntologyObjectId, ObjectHistoryEntry[]>();
  const provenance = new Map<OntologyObjectId, ObjectProvenance>();
  const links = new Map<string, LinkInstance>(); // key = linkType|source|target

  function requireMapping(id: MappingId): DatasetObjectMapping {
    const m = mappings.get(id);
    if (!m) throw new Error(`mapping desconhecido: ${id}`);
    return m;
  }

  function requireMappingVersion(id: MappingVersionId): MappingVersion {
    const v = mappingVersions.get(id);
    if (!v) throw new Error(`mapping version desconhecida: ${id}`);
    return v;
  }

  function canRead(principal: PrincipalId, objectId: OntologyObjectId): boolean {
    const r = authorize({
      principal,
      resource: objectResourceId(objectId),
      operation: 'read',
    });
    return r.decision === 'allow' || r.decision === 'partial';
  }

  function appendHistory(
    obj: OntologyObject,
    source: ObjectHistoryEntry['source'],
    principal?: PrincipalId,
    datasetVersionId?: string,
  ): void {
    const entry = freezeHistory({
      id: nextId('ohist'),
      objectId: obj.id,
      version: obj.version,
      at: obj.updatedAt,
      source,
      properties: { ...obj.properties },
      deleted: obj.deleted,
      mappingVersionId: obj.mappingVersionId,
      datasetVersionId,
      principal,
    });
    const list = history.get(obj.id) ?? [];
    list.push(entry);
    history.set(obj.id, list);
  }

  function projectRow(
    mv: MappingVersion,
    datasetVersionId: string,
    row: DatasetRow,
  ): { objectId: OntologyObjectId; upserted: boolean; skipped: boolean } {
    const pk = primaryKeyOf(row, mv.primaryKeyFields);
    const idxKey = `${mv.objectTypeId}::${pk}`;
    const existingId = indexByPk.get(idxKey);
    const existing = existingId ? objects.get(existingId) : undefined;

    // Regra patent: user edit vence data_source.
    if (existing?.createdOrEditedByUser) {
      return { objectId: existing.id, upserted: false, skipped: true };
    }

    const props: Record<PropertyTypeId, unknown> = {};
    for (const pm of mv.propertyMappings) {
      props[pm.propertyTypeId] = applyTransform(row.fields[pm.sourceField], pm);
    }

    const now = clock();
    if (existing) {
      const next: OntologyObject = freezeObject({
        ...existing,
        properties: props,
        version: existing.version + 1,
        deleted: false,
        updatedAt: now,
        mappingVersionId: mv.id,
        datasetVersionId,
      });
      objects.set(existing.id, next);
      appendHistory(next, 'data_source', undefined, datasetVersionId);
      provenance.set(existing.id, {
        objectId: existing.id,
        datasetId: mv.datasetId,
        datasetVersionId,
        mappingId: mv.mappingId,
        mappingVersionId: mv.id,
        primaryKey: pk,
        objectTypeId: mv.objectTypeId,
        sourceFields: [
          ...mv.primaryKeyFields,
          ...mv.propertyMappings.map((p) => p.sourceField),
        ],
      });
      return { objectId: existing.id, upserted: true, skipped: false };
    }

    const id = nextId('obj');
    const created = freezeObject({
      id,
      objectTypeId: mv.objectTypeId,
      primaryKey: pk,
      properties: props,
      version: 1,
      deleted: false,
      createdOrEditedByUser: false,
      updatedAt: now,
      mappingVersionId: mv.id,
      datasetVersionId,
    });
    objects.set(id, created);
    indexByPk.set(idxKey, id);
    appendHistory(created, 'data_source', undefined, datasetVersionId);
    provenance.set(id, {
      objectId: id,
      datasetId: mv.datasetId,
      datasetVersionId,
      mappingId: mv.mappingId,
      mappingVersionId: mv.id,
      primaryKey: pk,
      objectTypeId: mv.objectTypeId,
      sourceFields: [
        ...mv.primaryKeyFields,
        ...mv.propertyMappings.map((p) => p.sourceField),
      ],
    });
    return { objectId: id, upserted: true, skipped: false };
  }

  function projectLinks(
    mv: MappingVersion,
    datasetVersionId: string,
    row: DatasetRow,
    sourceObjectId: OntologyObjectId,
  ): number {
    let n = 0;
    for (const lm of mv.linkMappings) {
      const targetPk = String(row.fields[lm.sourceField] ?? '');
      if (!targetPk) continue;
      const targetId = indexByPk.get(`${lm.targetObjectTypeId}::${targetPk}`);
      if (!targetId) continue;
      const key = `${lm.linkTypeId}|${sourceObjectId}|${targetId}`;
      if (links.has(key)) continue;
      links.set(key, Object.freeze({
        id: nextId('link'),
        linkTypeId: lm.linkTypeId,
        sourceObjectId,
        targetObjectId: targetId,
        mappingVersionId: mv.id,
        datasetVersionId,
      }));
      n += 1;
    }
    return n;
  }

  function commitMapping(input: CommitMappingInput): MappingVersion {
    const m = requireMapping(input.mappingId);
    const draft = drafts.get(input.mappingId);
    if (!draft) throw new Error(`sem draft aberto: ${input.mappingId}`);
    if (!draft.primaryKeyFields.length) {
      throw new Error('commitMapping: primaryKeyFields obrigatório');
    }

    const list = versionsByMapping.get(input.mappingId) ?? [];
    const versionNumber = list.length + 1;
    const parentVersionId = list.length ? list[list.length - 1] : undefined;
    const content = {
      datasetId: m.datasetId,
      ontologyVersionId: draft.ontologyVersionId,
      objectTypeId: draft.objectTypeId,
      primaryKeyFields: draft.primaryKeyFields,
      propertyMappings: draft.propertyMappings,
      linkMappings: draft.linkMappings,
    };
    const version = Object.freeze({
      id: nextId('mapv'),
      mappingId: input.mappingId,
      versionNumber,
      parentVersionId,
      createdAt: clock(),
      createdBy: input.createdBy ?? 'system',
      contentHash: hashCanonical(content),
      status: 'COMMITTED' as const,
      datasetId: m.datasetId,
      ontologyVersionId: draft.ontologyVersionId,
      objectTypeId: draft.objectTypeId,
      primaryKeyFields: [...draft.primaryKeyFields],
      propertyMappings: structuredClone(draft.propertyMappings),
      linkMappings: structuredClone(draft.linkMappings),
    }) as MappingVersion;
    Object.freeze(version.primaryKeyFields);
    Object.freeze(version.propertyMappings);
    Object.freeze(version.linkMappings);
    assertMappingVersion(version);
    mappingVersions.set(version.id, version);
    list.push(version.id);
    versionsByMapping.set(input.mappingId, list);
    m.latestVersionId = version.id;
    drafts.delete(input.mappingId);
    return version;
  }

  return {
    createMapping(input: CreateMappingInput): DatasetObjectMapping {
      if (!input.primaryKeyFields?.length) {
        throw new Error('createMapping: primaryKeyFields obrigatório');
      }
      const id = nextId('map');
      const createdAt = clock();
      const mapping: DatasetObjectMapping = {
        id,
        name: input.name,
        datasetId: input.datasetId,
        objectTypeId: input.objectTypeId,
        createdAt,
      };
      mappings.set(id, mapping);
      drafts.set(id, {
        mappingId: id,
        ontologyVersionId: input.ontologyVersionId,
        objectTypeId: input.objectTypeId,
        primaryKeyFields: [...input.primaryKeyFields],
        propertyMappings: structuredClone(input.propertyMappings),
        linkMappings: structuredClone(input.linkMappings ?? []),
      });
      // Auto-commit v1; evolução via openMappingDraft → set → commit.
      commitMapping({ mappingId: id, createdBy: input.createdBy });
      return mapping;
    },

    getMapping(mappingId) {
      return mappings.get(mappingId);
    },

    openMappingDraft(mappingId) {
      const m = requireMapping(mappingId);
      const latest = m.latestVersionId
        ? requireMappingVersion(m.latestVersionId)
        : undefined;
      const draft: MappingDraft = latest
        ? {
            mappingId,
            baseVersionId: latest.id,
            ontologyVersionId: latest.ontologyVersionId,
            objectTypeId: latest.objectTypeId,
            primaryKeyFields: [...latest.primaryKeyFields],
            propertyMappings: structuredClone(latest.propertyMappings),
            linkMappings: structuredClone(latest.linkMappings),
          }
        : {
            mappingId,
            ontologyVersionId: '',
            objectTypeId: m.objectTypeId,
            primaryKeyFields: [],
            propertyMappings: [],
            linkMappings: [],
          };
      drafts.set(mappingId, draft);
      return structuredClone(draft);
    },

    setMappingDraft(mappingId, draft) {
      requireMapping(mappingId);
      const prev = drafts.get(mappingId);
      drafts.set(mappingId, {
        mappingId,
        baseVersionId: prev?.baseVersionId,
        ...structuredClone(draft),
      });
    },

    commitMapping,

    getMappingVersion(versionId) {
      return mappingVersions.get(versionId);
    },

    getLatestMappingVersion(mappingId) {
      const m = mappings.get(mappingId);
      if (!m?.latestVersionId) return undefined;
      return mappingVersions.get(m.latestVersionId);
    },

    listMappingVersions(mappingId) {
      const ids = versionsByMapping.get(mappingId) ?? [];
      return ids.map((id) => requireMappingVersion(id));
    },

    project(input: ProjectInput): ProjectResult {
      const mv = requireMappingVersion(input.mappingVersionId);
      const runId = nextId('proj');
      const objectIds: OntologyObjectId[] = [];
      let upserted = 0;
      let linksUpserted = 0;

      // Pass 1: objects (para PK targets existirem antes dos links).
      const rowResults: { objectId: OntologyObjectId; skipped: boolean; row: DatasetRow }[] =
        [];
      for (const row of input.rows) {
        const r = projectRow(mv, input.datasetVersionId, row);
        rowResults.push({ objectId: r.objectId, skipped: r.skipped, row });
        if (r.upserted) {
          upserted += 1;
          objectIds.push(r.objectId);
        } else if (!r.skipped) {
          objectIds.push(r.objectId);
        }
      }

      // Pass 2: links
      for (const { objectId, skipped, row } of rowResults) {
        if (skipped) continue;
        linksUpserted += projectLinks(mv, input.datasetVersionId, row, objectId);
      }

      return {
        runId,
        upserted,
        deleted: 0,
        linksUpserted,
        objectIds: [...new Set(objectIds)],
      };
    },

    applyUserEdit(objectId, properties, principal) {
      const obj = objects.get(objectId);
      if (!obj) throw new Error(`objeto desconhecido: ${objectId}`);
      const write = authorize({
        principal,
        resource: objectResourceId(objectId),
        operation: 'modify',
      });
      if (write.decision === 'deny') {
        throw new Error(`authorize deny modify ${objectId}: ${write.reason}`);
      }
      const next = freezeObject({
        ...obj,
        properties: { ...obj.properties, ...properties },
        version: obj.version + 1,
        createdOrEditedByUser: true,
        updatedAt: clock(),
      });
      objects.set(objectId, next);
      appendHistory(next, 'user_edit', principal, obj.datasetVersionId);
      return next;
    },

    getObject(principal, objectId, at) {
      if (!canRead(principal, objectId)) return null;
      const obj = objects.get(objectId);
      if (!obj) return null;
      if (at == null) return obj;
      const hist = history.get(objectId) ?? [];
      const snap = hist.find((h) => h.version === at);
      if (!snap) return null;
      return freezeObject({
        ...obj,
        version: snap.version,
        properties: { ...snap.properties },
        deleted: snap.deleted,
        updatedAt: snap.at,
        mappingVersionId: snap.mappingVersionId,
        datasetVersionId: snap.datasetVersionId ?? obj.datasetVersionId,
      });
    },

    queryObjects(principal, query: ObjectQuery) {
      const out: OntologyObject[] = [];
      for (const obj of objects.values()) {
        if (!query.includeDeleted && obj.deleted) continue;
        if (query.objectTypeId && obj.objectTypeId !== query.objectTypeId) continue;
        if (query.where) {
          let ok = true;
          for (const [k, v] of Object.entries(query.where)) {
            if (obj.properties[k] !== v) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        if (!canRead(principal, obj.id)) continue;
        out.push(obj);
        if (query.limit != null && out.length >= query.limit) break;
      }
      return out;
    },

    traverseLinks(principal, objectId, linkTypeId) {
      if (!canRead(principal, objectId)) return [];
      const targets: OntologyObject[] = [];
      for (const link of links.values()) {
        if (link.sourceObjectId !== objectId) continue;
        if (linkTypeId && link.linkTypeId !== linkTypeId) continue;
        if (!canRead(principal, link.targetObjectId)) continue;
        const t = objects.get(link.targetObjectId);
        if (t && !t.deleted) targets.push(t);
      }
      return targets;
    },

    getHistory(principal, objectId) {
      if (!canRead(principal, objectId)) return null;
      if (!objects.has(objectId)) return null;
      return [...(history.get(objectId) ?? [])];
    },

    getProvenance(principal, objectId) {
      if (!canRead(principal, objectId)) return null;
      return provenance.get(objectId) ?? null;
    },
  };
}
