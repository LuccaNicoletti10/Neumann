/**
 * ontology-registry — src/core/pg-registry.ts
 * PostgreSQL OntologyRegistry. Committed versions survive restart.
 * Drafts are session-local (uncommitted work is not durable).
 */

import {
  assertObjectTypeDef,
  validateActionTypeDefSchema,
  type ActionTypeDef,
  type CommitOntologyInput,
  type CreateOntologyInput,
  type FunctionTypeDef,
  type LinkTypeDef,
  type ObjectTypeDef,
  type Ontology,
  type OntologyDiff,
  type OntologyDraft,
  type OntologyId,
  type OntologyRegistry,
  type OntologyVersion,
  type OntologyVersionId,
  type PropertyTypeDef,
  type SqlClient,
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { hashCanonical } from './hash.js';
import {
  changedKeys,
  cloneDraftMaps,
  contentPayload,
  emptyMaps,
  freezeVersion,
  mapsFromVersion,
  validateDraft,
} from './maps.js';
import type { CreateOntologyRegistryOptions } from './types.js';

export interface CreatePgOntologyRegistryOptions extends CreateOntologyRegistryOptions {
  sql: SqlClient;
}

function rowToOntology(row: Record<string, unknown>): Ontology {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? undefined : String(row.description),
    createdAt: new Date(String(row.created_at)).toISOString(),
    latestVersionId: row.latest_version_id == null ? undefined : String(row.latest_version_id),
  };
}

function rowToVersion(row: Record<string, unknown>): OntologyVersion {
  const snapshot = (row.snapshot as Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'>) ?? emptyMaps();
  return freezeVersion({
    id: String(row.id),
    ontologyId: String(row.ontology_id),
    versionNumber: Number(row.version_number),
    parentVersionId: row.parent_version_id == null ? undefined : String(row.parent_version_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    createdBy: String(row.created_by),
    contentHash: String(row.content_hash),
    status: 'COMMITTED',
    objectTypes: structuredClone(snapshot.objectTypes ?? {}),
    propertyTypes: structuredClone(snapshot.propertyTypes ?? {}),
    linkTypes: structuredClone(snapshot.linkTypes ?? {}),
    actionTypes: structuredClone(snapshot.actionTypes ?? {}),
    functionTypes: structuredClone(snapshot.functionTypes ?? {}),
  });
}

export function createPgOntologyRegistry(
  opts: CreatePgOntologyRegistryOptions,
): OntologyRegistry {
  const { sql } = opts;
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const drafts = new Map<OntologyId, OntologyDraft>();

  async function requireOntology(id: OntologyId): Promise<Ontology> {
    const o = await registry.getOntology(id);
    if (!o) throw new Error(`ontologia desconhecida: ${id}`);
    return o;
  }

  function requireDraft(id: OntologyId): OntologyDraft {
    const d = drafts.get(id);
    if (!d) throw new Error(`sem draft aberto: ${id}`);
    return d;
  }

  async function commitMaps(
    ontologyId: OntologyId,
    maps: Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'>,
    parentVersionId: OntologyVersionId | undefined,
    createdBy: string,
  ): Promise<OntologyVersion> {
    validateDraft({ ontologyId, baseVersionId: parentVersionId, ...maps });
    await requireOntology(ontologyId);
    const existing = await registry.listVersions(ontologyId);
    const versionNumber = existing.length + 1;
    const contentHash = hashCanonical(contentPayload(maps));
    const version = freezeVersion({
      id: nextId('ov'),
      ontologyId,
      versionNumber,
      parentVersionId,
      createdAt: clock(),
      createdBy,
      contentHash,
      status: 'COMMITTED',
      objectTypes: structuredClone(maps.objectTypes),
      propertyTypes: structuredClone(maps.propertyTypes),
      linkTypes: structuredClone(maps.linkTypes),
      actionTypes: structuredClone(maps.actionTypes),
      functionTypes: structuredClone(maps.functionTypes),
    });
    await sql.query(
      `INSERT INTO platform_ontology_versions (
         id, ontology_id, version_number, parent_version_id,
         created_at, created_by, content_hash, status, snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMMITTED',$8::jsonb)`,
      [
        version.id,
        ontologyId,
        versionNumber,
        parentVersionId ?? null,
        version.createdAt,
        createdBy,
        contentHash,
        JSON.stringify(contentPayload(maps)),
      ],
    );
    await sql.query(
      `UPDATE platform_ontologies SET latest_version_id = $1 WHERE id = $2`,
      [version.id, ontologyId],
    );
    drafts.delete(ontologyId);
    return version;
  }

  const registry: OntologyRegistry = {
    async createOntology(input: CreateOntologyInput): Promise<Ontology> {
      const ontology: Ontology = {
        id: nextId('onto'),
        name: input.name,
        description: input.description,
        createdAt: clock(),
      };
      await sql.query(
        `INSERT INTO platform_ontologies (id, name, description, created_at)
         VALUES ($1,$2,$3,$4)`,
        [ontology.id, ontology.name, ontology.description ?? null, ontology.createdAt],
      );
      drafts.set(ontology.id, { ontologyId: ontology.id, ...emptyMaps() });
      return ontology;
    },

    async getOntology(ontologyId) {
      const result = await sql.query(
        `SELECT * FROM platform_ontologies WHERE id = $1`,
        [ontologyId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToOntology(row) : undefined;
    },

    async listOntologies() {
      const result = await sql.query(
        `SELECT * FROM platform_ontologies ORDER BY created_at ASC`,
      );
      return (result.rows as Record<string, unknown>[]).map(rowToOntology);
    },

    async openDraft(ontologyId) {
      await requireOntology(ontologyId);
      const latest = await registry.getLatestVersion(ontologyId);
      const draft: OntologyDraft = latest
        ? { ontologyId, baseVersionId: latest.id, ...mapsFromVersion(latest) }
        : { ontologyId, ...emptyMaps() };
      drafts.set(ontologyId, draft);
      return draft;
    },

    async getDraft(ontologyId) {
      return drafts.get(ontologyId);
    },

    async addPropertyType(ontologyId, def: PropertyTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.propertyTypes[def.id]) throw new Error(`PropertyType já existe no draft: ${def.id}`);
      if (!def.displayName) throw new Error('PropertyType: displayName obrigatório');
      d.propertyTypes[def.id] = structuredClone(def);
    },

    async addObjectType(ontologyId, def: ObjectTypeDef) {
      const d = requireDraft(ontologyId);
      assertObjectTypeDef(def);
      if (d.objectTypes[def.id]) throw new Error(`ObjectType já existe no draft: ${def.id}`);
      for (const pid of def.propertyTypeIds) {
        if (!d.propertyTypes[pid]) {
          throw new Error(`PropertyType inexistente no draft: ${pid}`);
        }
      }
      d.objectTypes[def.id] = structuredClone(def);
    },

    async addLinkType(ontologyId, def: LinkTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.linkTypes[def.id]) throw new Error(`LinkType já existe no draft: ${def.id}`);
      if (!d.objectTypes[def.sourceObjectTypeId] || !d.objectTypes[def.targetObjectTypeId]) {
        throw new Error(`LinkType ${def.id}: ObjectTypes de ponta devem existir no draft`);
      }
      d.linkTypes[def.id] = structuredClone(def);
    },

    async addActionType(ontologyId, def: ActionTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.actionTypes[def.id]) throw new Error(`ActionType já existe no draft: ${def.id}`);
      // WHY: same schema validation as the memory registry — fail-closed at commit.
      const schemaErrors = validateActionTypeDefSchema(def);
      if (schemaErrors.length > 0) {
        throw new Error(
          `ActionType ${def.id} has invalid parameter schema: ${schemaErrors.map((e) => e.message).join('; ')}`,
        );
      }
      d.actionTypes[def.id] = structuredClone(def);
    },

    async addFunctionType(ontologyId, def: FunctionTypeDef) {
      const d = requireDraft(ontologyId);
      const existing = d.functionTypes[def.id];
      if (existing) {
        const prev = existing.functionVersion ?? 1;
        const next = def.functionVersion ?? 1;
        // WHY: later ontology commits may pin a new artifact; same version must not overwrite.
        if (next <= prev) {
          throw new Error(`FunctionType ${def.id} already exists; functionVersion must increase`);
        }
      }
      d.functionTypes[def.id] = structuredClone(def);
    },

    async commit(input: CommitOntologyInput): Promise<OntologyVersion> {
      const d = requireDraft(input.ontologyId);
      return commitMaps(
        input.ontologyId,
        cloneDraftMaps(d),
        d.baseVersionId,
        input.createdBy ?? 'system',
      );
    },

    async getVersion(versionId) {
      const result = await sql.query(
        `SELECT * FROM platform_ontology_versions WHERE id = $1`,
        [versionId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToVersion(row) : undefined;
    },

    async getLatestVersion(ontologyId) {
      const o = await registry.getOntology(ontologyId);
      if (!o?.latestVersionId) return undefined;
      return registry.getVersion(o.latestVersionId);
    },

    async listVersions(ontologyId) {
      const result = await sql.query(
        `SELECT * FROM platform_ontology_versions
         WHERE ontology_id = $1
         ORDER BY version_number ASC`,
        [ontologyId],
      );
      return (result.rows as Record<string, unknown>[]).map(rowToVersion);
    },

    async rollback(ontologyId, targetVersionId, createdBy = 'system') {
      await requireOntology(ontologyId);
      const target = await registry.getVersion(targetVersionId);
      if (!target || target.ontologyId !== ontologyId) {
        throw new Error(`versão alvo inválida: ${targetVersionId}`);
      }
      const latest = await registry.getLatestVersion(ontologyId);
      return commitMaps(ontologyId, mapsFromVersion(target), latest?.id, createdBy);
    },

    async diff(aId, bId): Promise<OntologyDiff> {
      const a = await registry.getVersion(aId);
      const b = await registry.getVersion(bId);
      if (!a || !b) throw new Error('versões desconhecidas para diff');
      const ot = changedKeys(a.objectTypes, b.objectTypes);
      const pt = changedKeys(a.propertyTypes, b.propertyTypes);
      const lt = changedKeys(a.linkTypes, b.linkTypes);
      return {
        a: aId,
        b: bId,
        addedObjectTypes: ot.added,
        removedObjectTypes: ot.removed,
        changedObjectTypes: ot.changed,
        addedPropertyTypes: pt.added,
        removedPropertyTypes: pt.removed,
        changedPropertyTypes: pt.changed,
        addedLinkTypes: lt.added,
        removedLinkTypes: lt.removed,
      };
    },
  };

  return registry;
}
