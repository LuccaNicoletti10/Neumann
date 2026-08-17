/**
 * replication — src/core/ontology-map.ts
 * US 9,330,157 / US 10,061,828 — mapa 1:1 / 1:N / reverse / drop + digest.
 */

import { hashPayload, type OntologyMapSpec, type OntologyTypeKind, type ReplicationMutation } from 'contracts';

export interface OntologyMap {
  spec: OntologyMapSpec;
  digest(): string;
  shouldDrop(siteId: string, typeUri: string): boolean;
  mapType(fromType: string, kind: OntologyTypeKind): string | undefined;
  getParentForChild(child: string, kind: 'object' | 'link'): string | undefined;
  isChild(parent: string, child: string, kind: 'object' | 'link'): boolean;
  shouldReverseLink(linkType: string): boolean;
  rewrite(mutation: ReplicationMutation, exportingSiteId: string): ReplicationMutation | null;
}

function parentChild(map: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(map)) out[k] = [...v].sort();
  return out;
}

export function ontologyMapDigest(spec: OntologyMapSpec): string {
  return hashPayload({
    systemIds: [...spec.systemIds],
    objectMappings: spec.objectMappings,
    propertyMappings: spec.propertyMappings,
    linkMappings: spec.linkMappings,
    objectParentChild: parentChild(spec.objectParentChild),
    linkParentChild: parentChild(spec.linkParentChild),
    linkReverse: [...spec.linkReverse].sort(),
    droppedTypes: Object.fromEntries(
      Object.entries(spec.droppedTypes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, [...v].sort()]),
    ),
  });
}

export function createOntologyMap(spec: OntologyMapSpec): OntologyMap {
  return {
    spec,
    digest() {
      return ontologyMapDigest(spec);
    },
    shouldDrop(siteId, typeUri) {
      return spec.droppedTypes[siteId]?.includes(typeUri) === true;
    },
    mapType(fromType, kind) {
      const table =
        kind === 'object' ? spec.objectMappings : kind === 'property' ? spec.propertyMappings : spec.linkMappings;
      return table[fromType];
    },
    getParentForChild(child, kind) {
      const table = kind === 'object' ? spec.objectParentChild : spec.linkParentChild;
      for (const [parent, children] of Object.entries(table)) {
        if (children.includes(child)) return parent;
      }
      return undefined;
    },
    isChild(parent, child, kind) {
      const table = kind === 'object' ? spec.objectParentChild : spec.linkParentChild;
      return table[parent]?.includes(child) === true;
    },
    shouldReverseLink(linkType) {
      return spec.linkReverse.includes(linkType);
    },
    rewrite(mutation, exportingSiteId) {
      const typeUri = mutation.objectType;
      if (typeUri && this.shouldDrop(exportingSiteId, typeUri)) return null;
      const mappedObject = typeUri ? (this.mapType(typeUri, 'object') ?? typeUri) : mutation.objectType;
      const mappedUnit = this.mapType(mutation.unitId, 'property') ?? mutation.unitId;
      return {
        ...mutation,
        objectType: mappedObject,
        unitId: mappedUnit,
      };
    },
  };
}

export function mapsCompatible(a: OntologyMap, b: OntologyMap): boolean {
  return a.digest() === b.digest();
}

export type PropertyBase = 'string' | 'number' | 'boolean';

function coerce(value: unknown, base: PropertyBase): unknown {
  if (base === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (base === 'boolean') return Boolean(value);
  return String(value);
}

/** Round-trip estável após 1 ou 2 conversões (US 9,330,157). */
export function propertyRoundTripStable(
  original: unknown,
  fromBase: PropertyBase,
  toBase: PropertyBase,
): boolean {
  const round1 = coerce(coerce(original, toBase), fromBase);
  if (original === round1) return true;
  const round2 = coerce(coerce(round1, toBase), fromBase);
  return round1 === round2;
}
