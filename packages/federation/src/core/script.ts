/**
 * federation — src/core/script.ts
 * Script default: fragments → TemporaryObject / PlatformObject (US 10,402,397).
 */

import type {
  DataFragment,
  FederatedScript,
  PlatformObject,
  TemporaryObject,
} from 'contracts';

import { aggregateAcl } from './acl.js';

const PROPERTY_KEYS = ['name', 'phone', 'email', 'ssn', 'title'] as const;

export function createDefaultFederatedScript(
  objectTypeId = 'ot.person',
): FederatedScript {
  return {
    id: 'default',
    name: 'Default federated person script',
    objectTypeId,

    getOntology() {
      return {
        objectTypes: [objectTypeId],
        propertyTypes: [...PROPERTY_KEYS],
        linkTypes: ['hasPhone', 'hasEmail', 'friend'],
      };
    },

    transformFragment(fragment: DataFragment): Partial<TemporaryObject> {
      const properties: Record<string, unknown> = {};
      const raw = fragment.rawData;
      for (const key of PROPERTY_KEYS) {
        if (raw[key] !== undefined) properties[key] = raw[key];
      }
      return { objectTypeId, properties, links: [] };
    },

    mergeFragments(fragments: DataFragment[]): TemporaryObject {
      const id = fragments[0]?.objectId ?? 'unknown';
      const properties: Record<string, unknown> = {};
      const links: TemporaryObject['links'] = [];
      for (const frag of fragments) {
        const partial = this.transformFragment(frag);
        if (partial.properties) Object.assign(properties, partial.properties);
        if (partial.links) links.push(...partial.links);
      }
      return {
        kind: 'temporary',
        id,
        objectTypeId,
        properties,
        links,
        fragments,
        promoted: false,
        acl: aggregateAcl(fragments, fragments[0]?.lastUpdated ?? '1970-01-01T00:00:00.000Z'),
        copyOnWrite: true,
        provenance: 'federated',
        expiresAt: '1970-01-01T00:00:00.000Z',
      };
    },

    toPlatformObject(temp: TemporaryObject, at: string): PlatformObject {
      return {
        kind: 'platform',
        id: temp.id,
        objectTypeId: temp.objectTypeId,
        properties: { ...temp.properties },
        links: [...temp.links],
        sourceFragments: temp.fragments.map((f) => ({ ...f, rawData: { ...f.rawData } })),
        promotionMetadata: temp.promotionMetadata ?? {
          fragmentIds: temp.fragments.map((f) => f.id),
          promotedProperties: [],
          promotedLinks: [],
          promotedAt: at,
          promotedBy: 'system',
        },
        acl: temp.acl,
        copyOnWrite: true,
        provenance: 'promoted',
        createdAt: at,
        updatedAt: at,
      };
    },
  };
}
