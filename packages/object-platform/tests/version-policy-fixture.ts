/**
 * Test fixture: a pinned OntologyVersion built from a compact declaration.
 * WHY: governed repositories require a version authority; tests that do not
 * exercise the registry still must go through the same governance layer.
 */
import type { OntologyVersion, PropertyTypeDef } from 'contracts';

import type { OntologyVersionPolicy } from '../src/core/ontology-version-policy.js';

export interface FixtureVersionSpec {
  id?: string;
  ontologyId?: string;
  objectTypes: Record<string, readonly string[]>;
  propertyTypes?: Record<string, PropertyTypeDef>;
  linkTypes?: OntologyVersion['linkTypes'];
}

export function fixtureOntologyVersion(spec: FixtureVersionSpec): OntologyVersion {
  const objectTypes: OntologyVersion['objectTypes'] = {};
  for (const [id, propertyTypeIds] of Object.entries(spec.objectTypes)) {
    objectTypes[id] = { id, displayName: id, propertyTypeIds: [...propertyTypeIds] };
  }
  const propertyTypes: OntologyVersion['propertyTypes'] = { ...(spec.propertyTypes ?? {}) };
  for (const ids of Object.values(spec.objectTypes)) {
    for (const pid of ids) {
      propertyTypes[pid] ??= { id: pid, displayName: pid, baseType: 'string' };
    }
  }
  return {
    id: spec.id ?? 'ov-fixture',
    ontologyId: spec.ontologyId ?? 'o1',
    versionNumber: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'fixture',
    contentHash: 'h',
    status: 'COMMITTED',
    objectTypes,
    propertyTypes,
    linkTypes: spec.linkTypes ?? {},
    actionTypes: {},
    functionTypes: {},
  };
}

export function fixtureVersionPolicy(version: OntologyVersion): OntologyVersionPolicy {
  return { pin: async () => ({ version }) };
}
