/**
 * ontology-registry — src/core/maps.ts
 * Shared draft/snapshot helpers for memory and PostgreSQL registries.
 */

import {
  assertObjectTypeDef,
  compilePattern,
  validateActionTypeDefSchema,
  type OntologyDraft,
  type OntologyVersion,
} from 'contracts';

import { hashCanonical } from './hash.js';

export function cloneDraftMaps(d: OntologyDraft): Omit<
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

export function emptyMaps(): Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'> {
  return {
    objectTypes: {},
    propertyTypes: {},
    linkTypes: {},
    actionTypes: {},
    functionTypes: {},
  };
}

export function mapsFromVersion(
  v: OntologyVersion,
): Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'> {
  return {
    objectTypes: structuredClone(v.objectTypes),
    propertyTypes: structuredClone(v.propertyTypes),
    linkTypes: structuredClone(v.linkTypes),
    actionTypes: structuredClone(v.actionTypes),
    functionTypes: structuredClone(v.functionTypes),
  };
}

export function contentPayload(
  maps: Omit<OntologyDraft, 'ontologyId' | 'baseVersionId'>,
): unknown {
  return {
    objectTypes: maps.objectTypes,
    propertyTypes: maps.propertyTypes,
    linkTypes: maps.linkTypes,
    actionTypes: maps.actionTypes,
    functionTypes: maps.functionTypes,
  };
}

export function freezeVersion(version: OntologyVersion): OntologyVersion {
  Object.freeze(version.objectTypes);
  Object.freeze(version.propertyTypes);
  Object.freeze(version.linkTypes);
  Object.freeze(version.actionTypes);
  Object.freeze(version.functionTypes);
  Object.freeze(version);
  return version;
}

export function changedKeys<T>(
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

export function validateDraft(d: OntologyDraft): void {
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
  for (const def of Object.values(d.propertyTypes)) {
    for (const v of def.validators ?? []) {
      if (v.kind === 'regex') {
        // WHY: PropertyType regex is admitted at commit with the same linear-safe
        // subset as ActionType patterns so a dangerous pattern never reaches apply.
        compilePattern(def.id, v.pattern);
      }
    }
  }
  for (const def of Object.values(d.actionTypes)) {
    const schemaErrors = validateActionTypeDefSchema(def);
    if (schemaErrors.length > 0) {
      throw new Error(
        `ActionType ${def.id} has invalid parameter schema: ${schemaErrors.map((e) => e.message).join('; ')}`,
      );
    }
  }
}
