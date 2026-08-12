/**
 * ontology-registry — src/core/registry.ts
 * OntologyRegistry: draft → commit (nova versão) → rollback (nova versão = snapshot antigo).
 */

import {
  assertObjectTypeDef,
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
} from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { hashCanonical } from './hash.js';
import type { CreateOntologyRegistryOptions } from './types.js';

function cloneDraftMaps(d: OntologyDraft): Omit<
  OntologyDraft,
  'ontologyId' | 'baseVersionId'
> {
  return {
    objectTypes: structuredClone(d.objectTypes),
    propertyTypes: structuredClone(d.propertyTypes),
    linkTypes: structuredClone(d.linkTypes),
    actionTypes: structuredClone(d.actionTypes),
    functionTypes: structuredClone(d.functionTypes),
  };
}

function emptyMaps(): Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'> {
  return {
    objectTypes: {},
    propertyTypes: {},
    linkTypes: {},
    actionTypes: {},
    functionTypes: {},
  };
}

function mapsFromVersion(v: OntologyVersion): Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'> {
  return {
    objectTypes: structuredClone(v.objectTypes),
    propertyTypes: structuredClone(v.propertyTypes),
    linkTypes: structuredClone(v.linkTypes),
    actionTypes: structuredClone(v.actionTypes),
    functionTypes: structuredClone(v.functionTypes),
  };
}

function contentPayload(maps: Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'>): unknown {
  return {
    objectTypes: maps.objectTypes,
    propertyTypes: maps.propertyTypes,
    linkTypes: maps.linkTypes,
    actionTypes: maps.actionTypes,
    functionTypes: maps.functionTypes,
  };
}

function changedKeys<T>(
  a: Record<string, T>,
  b: Record<string, T>,
): { added: string[]; removed: string[]; changed: string[] } {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  const added = [...bKeys].filter((k) => !aKeys.has(k));
  const removed = [...aKeys].filter((k) => !bKeys.has(k));
  const changed: string[] = [];
  for (const k of aKeys) {
    if (!bKeys.has(k)) continue;
    if (hashCanonical(a[k]) !== hashCanonical(b[k])) changed.push(k);
  }
  return { added, removed, changed };
}

export function createOntologyRegistry(
  opts: CreateOntologyRegistryOptions = {},
): OntologyRegistry {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();

  const ontologies = new Map<OntologyId, Ontology>();
  const versions = new Map<OntologyVersionId, OntologyVersion>();
  const versionsByOntology = new Map<OntologyId, OntologyVersionId[]>();
  const drafts = new Map<OntologyId, OntologyDraft>();

  function requireOntology(id: OntologyId): Ontology {
    const o = ontologies.get(id);
    if (!o) throw new Error(`ontologia desconhecida: ${id}`);
    return o;
  }

  function requireDraft(id: OntologyId): OntologyDraft {
    const d = drafts.get(id);
    if (!d) throw new Error(`sem draft aberto: ${id}`);
    return d;
  }

  function validateDraft(d: OntologyDraft): void {
    for (const ot of Object.values(d.objectTypes)) {
      assertObjectTypeDef(ot);
      for (const pid of ot.propertyTypeIds) {
        if (!d.propertyTypes[pid]) {
          throw new Error(`ObjectType ${ot.id} referencia PropertyType inexistente: ${pid}`);
        }
      }
    }
    for (const lt of Object.values(d.linkTypes)) {
      if (!d.objectTypes[lt.sourceObjectTypeId]) {
        throw new Error(`LinkType ${lt.id}: source ObjectType inexistente`);
      }
      if (!d.objectTypes[lt.targetObjectTypeId]) {
        throw new Error(`LinkType ${lt.id}: target ObjectType inexistente`);
      }
    }
  }

  function commitMaps(
    ontologyId: OntologyId,
    maps: Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'>,
    parentVersionId: OntologyVersionId | undefined,
    createdBy: string,
  ): OntologyVersion {
    validateDraft({ ontologyId, baseVersionId: parentVersionId, ...maps });
    const o = requireOntology(ontologyId);
    const list = versionsByOntology.get(ontologyId) ?? [];
    const versionNumber = list.length + 1;
    const contentHash = hashCanonical(contentPayload(maps));
    const version: OntologyVersion = {
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
    };
    // Imutabilidade: freeze shallow + nested records already cloned.
    Object.freeze(version.objectTypes);
    Object.freeze(version.propertyTypes);
    Object.freeze(version.linkTypes);
    Object.freeze(version.actionTypes);
    Object.freeze(version.functionTypes);
    Object.freeze(version);

    versions.set(version.id, version);
    list.push(version.id);
    versionsByOntology.set(ontologyId, list);
    o.latestVersionId = version.id;
    drafts.delete(ontologyId);
    return version;
  }

  const registry: OntologyRegistry = {
    createOntology(input: CreateOntologyInput): Ontology {
      const ontology: Ontology = {
        id: nextId('onto'),
        name: input.name,
        description: input.description,
        createdAt: clock(),
      };
      ontologies.set(ontology.id, ontology);
      versionsByOntology.set(ontology.id, []);
      drafts.set(ontology.id, {
        ontologyId: ontology.id,
        ...emptyMaps(),
      });
      return ontology;
    },

    getOntology(ontologyId) {
      return ontologies.get(ontologyId);
    },

    openDraft(ontologyId) {
      requireOntology(ontologyId);
      const latest = registry.getLatestVersion(ontologyId);
      const draft: OntologyDraft = latest
        ? {
            ontologyId,
            baseVersionId: latest.id,
            ...mapsFromVersion(latest),
          }
        : { ontologyId, ...emptyMaps() };
      drafts.set(ontologyId, draft);
      return draft;
    },

    getDraft(ontologyId) {
      return drafts.get(ontologyId);
    },

    addPropertyType(ontologyId, def: PropertyTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.propertyTypes[def.id]) throw new Error(`PropertyType já existe no draft: ${def.id}`);
      if (!def.displayName) throw new Error('PropertyType: displayName obrigatório');
      d.propertyTypes[def.id] = structuredClone(def);
    },

    addObjectType(ontologyId, def: ObjectTypeDef) {
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

    addLinkType(ontologyId, def: LinkTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.linkTypes[def.id]) throw new Error(`LinkType já existe no draft: ${def.id}`);
      if (!d.objectTypes[def.sourceObjectTypeId] || !d.objectTypes[def.targetObjectTypeId]) {
        throw new Error(`LinkType ${def.id}: ObjectTypes de ponta devem existir no draft`);
      }
      d.linkTypes[def.id] = structuredClone(def);
    },

    addActionType(ontologyId, def: ActionTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.actionTypes[def.id]) throw new Error(`ActionType já existe no draft: ${def.id}`);
      d.actionTypes[def.id] = structuredClone(def);
    },

    addFunctionType(ontologyId, def: FunctionTypeDef) {
      const d = requireDraft(ontologyId);
      if (d.functionTypes[def.id]) throw new Error(`FunctionType já existe no draft: ${def.id}`);
      d.functionTypes[def.id] = structuredClone(def);
    },

    commit(input: CommitOntologyInput): OntologyVersion {
      const d = requireDraft(input.ontologyId);
      const maps = cloneDraftMaps(d);
      return commitMaps(
        input.ontologyId,
        maps,
        d.baseVersionId,
        input.createdBy ?? 'system',
      );
    },

    getVersion(versionId) {
      return versions.get(versionId);
    },

    getLatestVersion(ontologyId) {
      const o = ontologies.get(ontologyId);
      if (!o?.latestVersionId) return undefined;
      return versions.get(o.latestVersionId);
    },

    listVersions(ontologyId) {
      const ids = versionsByOntology.get(ontologyId) ?? [];
      return ids.map((id) => versions.get(id)!);
    },

    rollback(ontologyId, targetVersionId, createdBy = 'system') {
      requireOntology(ontologyId);
      const target = versions.get(targetVersionId);
      if (!target || target.ontologyId !== ontologyId) {
        throw new Error(`versão alvo inválida: ${targetVersionId}`);
      }
      // Nunca update in-place: nova versão com mesmo conteúdo do target.
      const latest = registry.getLatestVersion(ontologyId);
      return commitMaps(
        ontologyId,
        mapsFromVersion(target),
        latest?.id,
        createdBy,
      );
    },

    diff(aId, bId): OntologyDiff {
      const a = versions.get(aId);
      const b = versions.get(bId);
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
