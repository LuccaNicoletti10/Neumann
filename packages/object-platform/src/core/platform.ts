/**
 * object-platform — src/core/platform.ts
 * Mapping versionado + projetor. Objects/links/history vivem nos repositories.
 *
 * Ownership: mapping Maps are a mapping registry, not object storage.
 * Identity: ontologyId + objectTypeId + primaryKey. `id` is a handle.
 * CAS/atomicity: delegated to ObjectRepository / LinkRepository.
 */

import {
  assertMappingVersion,
  type CommitMappingInput,
  type CreateMappingInput,
  type DatasetObjectMapping,
  type DatasetRow,
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
  type ObjectRepository,
  type LinkRepository,
  type ObjectRecord,
} from 'contracts';
import { allowsMutation, allowsRead } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { hashCanonical } from './hash.js';
import { createMemoryLinkRepository } from './link-repository.js';
import { createMemoryObjectHistoryStore, type ObjectHistoryStore } from './object-history-store.js';
import { createMemoryObjectRepository } from './object-repository.js';
import type { CreateObjectPlatformOptions } from './types.js';

/** Default ontology namespace when the facade owns its memory adapters. */
export const OBJECT_PLATFORM_ONTOLOGY_ID = 'platform';

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
  // WHY: must match ResourceIds.objectType(KERNEL_ONTOLOGY, objectId) without depending on policy-engine.
  return `object:_/${encodeURIComponent(objectId)}`;
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function userEditedFromHistory(
  history: ObjectHistoryStore,
  objectId: string,
): Promise<boolean> {
  const entries = await history.listByObject(objectId);
  return entries.some((e) => e.source === 'user_edit');
}

function toOntologyObject(rec: ObjectRecord, userEdited: boolean): OntologyObject {
  const p = rec.provenance ?? {};
  return freezeObject({
    id: rec.id,
    objectTypeId: rec.objectTypeId,
    primaryKey: rec.primaryKey,
    properties: rec.properties as Record<PropertyTypeId, unknown>,
    version: rec.version,
    deleted: rec.deleted,
    createdOrEditedByUser: userEdited,
    updatedAt: rec.updatedAt,
    mappingVersionId: str(p.mappingVersionId) ?? '',
    datasetVersionId: str(p.datasetVersionId) ?? '',
  });
}

function toPlatformHistory(
  rec: ObjectRecord,
  entry: { id: string; version: number; createdAt: string; source?: string; properties: Record<string, unknown>; deleted: boolean; principal?: string; provenance?: Record<string, unknown> },
): ObjectHistoryEntry {
  const p = entry.provenance ?? rec.provenance ?? {};
  return freezeHistory({
    id: entry.id,
    objectId: rec.id,
    version: entry.version,
    at: entry.createdAt,
    source: entry.source === 'user_edit' ? 'user_edit' : 'data_source',
    properties: entry.properties as Record<PropertyTypeId, unknown>,
    deleted: entry.deleted,
    mappingVersionId: str(p.mappingVersionId) ?? str(rec.provenance?.mappingVersionId) ?? '',
    datasetVersionId: str(p.datasetVersionId) ?? str(rec.provenance?.datasetVersionId),
    principal: entry.principal,
  });
}

function toProvenance(rec: ObjectRecord): ObjectProvenance | null {
  const p = rec.provenance ?? {};
  const datasetId = str(p.datasetId);
  const datasetVersionId = str(p.datasetVersionId);
  const mappingId = str(p.mappingId);
  const mappingVersionId = str(p.mappingVersionId);
  if (!datasetId || !datasetVersionId || !mappingId || !mappingVersionId) return null;
  const sourceFields = Array.isArray(p.sourceFields)
    ? p.sourceFields.filter((f): f is string => typeof f === 'string')
    : [];
  return {
    objectId: rec.id,
    datasetId,
    datasetVersionId,
    mappingId,
    mappingVersionId,
    primaryKey: rec.primaryKey,
    objectTypeId: rec.objectTypeId,
    sourceFields,
  };
}

/**
 * Mapping + project facade over canonical repositories.
 *
 * Does not own object/link/history Maps. Injected async (PG) stores fail closed;
 * PostgreSQL ingestion uses ProjectionWriter + UnitOfWork.
 */
export function createObjectPlatform(opts: CreateObjectPlatformOptions): ObjectPlatform {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const authorize = opts.authorize;
  if (!authorize) {
    throw new Error(
      'createObjectPlatform requires authorize (fail-closed; tests use createAllowAllTestPolicy)',
    );
  }
  const ontologyId = opts.ontologyId ?? OBJECT_PLATFORM_ONTOLOGY_ID;
  const objects: ObjectRepository =
    opts.objects ?? createMemoryObjectRepository({ clock, nextId });
  const history: ObjectHistoryStore =
    opts.history ?? createMemoryObjectHistoryStore({ clock, nextId });
  const links: LinkRepository =
    opts.links ??
    createMemoryLinkRepository({
      clock,
      nextId,
      objectExists: async (oid, typeId, pk) => Boolean(await objects.get(oid, typeId, pk)),
    });

  const mappings = new Map<MappingId, DatasetObjectMapping>();
  const mappingVersions = new Map<MappingVersionId, MappingVersion>();
  const versionsByMapping = new Map<MappingId, MappingVersionId[]>();
  const drafts = new Map<MappingId, MappingDraft>();
  const knownObjectTypeIds = new Set<string>();

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
    return allowsRead(r);
  }

  function getLiveById(objectId: OntologyObjectId): Promise<ObjectRecord | undefined> {
    return objects.getById(objectId);
  }

  async function appendHistory(
    rec: ObjectRecord,
    source: ObjectHistoryEntry['source'],
    operation: 'create' | 'update',
    principal?: PrincipalId,
  ): Promise<void> {
    await history.append({
      objectId: rec.id,
      ontologyId: rec.ontologyId,
      ontologyVersionId: rec.ontologyVersionId,
      objectTypeId: rec.objectTypeId,
      primaryKey: rec.primaryKey,
      version: rec.version,
      properties: { ...rec.properties },
      deleted: rec.deleted,
      source,
      principal,
      operation,
      provenance: rec.provenance,
    });
  }

  async function projectRow(
    mv: MappingVersion,
    datasetVersionId: string,
    row: DatasetRow,
  ): Promise<{ objectId: OntologyObjectId; upserted: boolean; skipped: boolean }> {
    const pk = primaryKeyOf(row, mv.primaryKeyFields);
    knownObjectTypeIds.add(mv.objectTypeId);
    const existing = await objects.get(ontologyId, mv.objectTypeId, pk);

    if (existing && (await userEditedFromHistory(history, existing.id))) {
      return { objectId: existing.id, upserted: false, skipped: true };
    }

    const props: Record<PropertyTypeId, unknown> = {};
    for (const pm of mv.propertyMappings) {
      props[pm.propertyTypeId] = applyTransform(row.fields[pm.sourceField], pm);
    }

    const provenance = {
      datasetId: mv.datasetId,
      datasetVersionId,
      mappingId: mv.mappingId,
      mappingVersionId: mv.id,
      primaryKey: pk,
      objectTypeId: mv.objectTypeId,
      sourceFields: [...mv.primaryKeyFields, ...mv.propertyMappings.map((p) => p.sourceField)],
    };

    if (existing) {
      const next = await objects.update(ontologyId, mv.objectTypeId, pk, {
        properties: props,
        mode: 'replace',
        provenance,
      });
      await appendHistory(next, 'data_source', 'update');
      return { objectId: existing.id, upserted: true, skipped: false };
    }

    const created = await objects.create({
      ontologyId,
      objectTypeId: mv.objectTypeId,
      primaryKey: pk,
      properties: props,
      source: 'data_source',
      provenance,
    });
    await appendHistory(created, 'data_source', 'create');
    return { objectId: created.id, upserted: true, skipped: false };
  }

  async function projectLinks(
    mv: MappingVersion,
    datasetVersionId: string,
    row: DatasetRow,
    source: ObjectRecord,
  ): Promise<number> {
    let n = 0;
    for (const lm of mv.linkMappings) {
      const targetPk = String(row.fields[lm.sourceField] ?? '');
      if (!targetPk) continue;
      const target = await objects.get(ontologyId, lm.targetObjectTypeId, targetPk);
      if (!target) continue;
      const existing = await links.listFrom(
        ontologyId,
        source.objectTypeId,
        source.primaryKey,
        lm.linkTypeId,
      );
      if (existing.some((l) => l.targetPrimaryKey === targetPk && !l.deleted)) continue;
      await links.create({
        ontologyId,
        linkTypeId: lm.linkTypeId,
        sourceObjectTypeId: source.objectTypeId,
        sourcePrimaryKey: source.primaryKey,
        targetObjectTypeId: target.objectTypeId,
        targetPrimaryKey: target.primaryKey,
        provenance: {
          mappingVersionId: mv.id,
          datasetVersionId,
        },
      });
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

  async function listKnownRecords(includeDeleted: boolean): Promise<ObjectRecord[]> {
    const types = new Set<string>(knownObjectTypeIds);
    for (const m of mappings.values()) types.add(m.objectTypeId);
    const out: ObjectRecord[] = [];
    for (const typeId of types) {
      out.push(...(await objects.list(ontologyId, typeId, { includeDeleted })));
    }
    return out;
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
      knownObjectTypeIds.add(input.objectTypeId);
      drafts.set(id, {
        mappingId: id,
        ontologyVersionId: input.ontologyVersionId,
        objectTypeId: input.objectTypeId,
        primaryKeyFields: [...input.primaryKeyFields],
        propertyMappings: structuredClone(input.propertyMappings),
        linkMappings: structuredClone(input.linkMappings ?? []),
      });
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

    async project(input: ProjectInput): Promise<ProjectResult> {
      const mv = requireMappingVersion(input.mappingVersionId);
      const runId = nextId('proj');
      const objectIds: OntologyObjectId[] = [];
      let upserted = 0;
      let linksUpserted = 0;

      const rowResults: { objectId: OntologyObjectId; skipped: boolean; row: DatasetRow }[] =
        [];
      for (const row of input.rows) {
        const r = await projectRow(mv, input.datasetVersionId, row);
        rowResults.push({ objectId: r.objectId, skipped: r.skipped, row });
        if (r.upserted) {
          upserted += 1;
          objectIds.push(r.objectId);
        } else if (!r.skipped) {
          objectIds.push(r.objectId);
        }
      }

      for (const { objectId, skipped, row } of rowResults) {
        if (skipped) continue;
        const source = await getLiveById(objectId);
        if (!source) continue;
        linksUpserted += await projectLinks(mv, input.datasetVersionId, row, source);
      }

      return {
        runId,
        upserted,
        deleted: 0,
        linksUpserted,
        objectIds: [...new Set(objectIds)],
      };
    },

    async applyUserEdit(objectId, properties, principal) {
      const rec = await getLiveById(objectId);
      if (!rec) throw new Error(`objeto desconhecido: ${objectId}`);
      const write = authorize({
        principal,
        resource: objectResourceId(objectId),
        operation: 'modify',
      });
      if (!allowsMutation(write)) {
        throw new Error(`authorize deny modify ${objectId}: ${write.reason}`);
      }
      const next = await objects.update(rec.ontologyId, rec.objectTypeId, rec.primaryKey, {
        properties: properties as Record<string, unknown>,
      });
      await appendHistory(
        { ...next, provenance: rec.provenance },
        'user_edit',
        'update',
        principal,
      );
      return toOntologyObject(next, true);
    },

    async getObject(principal, objectId, at) {
      if (!canRead(principal, objectId)) return null;
      const rec = await getLiveById(objectId);
      if (!rec) return null;
      const edited = await userEditedFromHistory(history, rec.id);
      if (at == null) return toOntologyObject(rec, edited);
      const hist = await history.listByObject(objectId);
      const snap = hist.find((h) => h.version === at);
      if (!snap) return null;
      return freezeObject({
        ...toOntologyObject(rec, edited),
        version: snap.version,
        properties: { ...snap.properties } as Record<PropertyTypeId, unknown>,
        deleted: snap.deleted,
        updatedAt: snap.createdAt,
        mappingVersionId:
          str(snap.provenance?.mappingVersionId) ?? str(rec.provenance?.mappingVersionId) ?? '',
        datasetVersionId:
          str(snap.provenance?.datasetVersionId) ?? str(rec.provenance?.datasetVersionId) ?? '',
      });
    },

    async queryObjects(principal, query: ObjectQuery) {
      const out: OntologyObject[] = [];
      const records = query.objectTypeId
        ? await objects.list(ontologyId, query.objectTypeId, {
            includeDeleted: query.includeDeleted,
          })
        : await listKnownRecords(Boolean(query.includeDeleted));
      for (const rec of records) {
        if (!query.includeDeleted && rec.deleted) continue;
        if (query.where) {
          let ok = true;
          for (const [k, v] of Object.entries(query.where)) {
            if (rec.properties[k] !== v) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        if (!canRead(principal, rec.id)) continue;
        out.push(toOntologyObject(rec, await userEditedFromHistory(history, rec.id)));
        if (query.limit != null && out.length >= query.limit) break;
      }
      return out;
    },

    async traverseLinks(principal, objectId, linkTypeId) {
      if (!canRead(principal, objectId)) return [];
      const rec = await getLiveById(objectId);
      if (!rec) return [];
      const from = await links.listFrom(
        rec.ontologyId,
        rec.objectTypeId,
        rec.primaryKey,
        linkTypeId,
      );
      const targets: OntologyObject[] = [];
      for (const link of from) {
        const t = await objects.get(
          link.ontologyId,
          link.targetObjectTypeId,
          link.targetPrimaryKey,
        );
        if (!t || t.deleted) continue;
        if (!canRead(principal, t.id)) continue;
        targets.push(toOntologyObject(t, await userEditedFromHistory(history, t.id)));
      }
      return targets;
    },

    async getHistory(principal, objectId) {
      if (!canRead(principal, objectId)) return null;
      const rec = await getLiveById(objectId);
      if (!rec) return null;
      const entries = await history.listByObject(objectId);
      return entries.map((e) => toPlatformHistory(rec, e));
    },

    async getProvenance(principal, objectId) {
      if (!canRead(principal, objectId)) return null;
      const rec = await getLiveById(objectId);
      if (!rec) return null;
      return toProvenance(rec);
    },
  };
}
