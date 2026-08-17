/**
 * federation — src/core/acl.ts
 * ACL da fonte + redaction (US 11,681,690).
 */

import type {
  AccessControlProperties,
  AclEntry,
  AclLevel,
  FederationPrincipal,
  TemporaryObject,
} from 'contracts';

const RANK: Record<AclLevel, number> = { read: 1, write: 2, admin: 3 };

export function principalKeys(principal: FederationPrincipal): Set<string> {
  return new Set([principal.id, ...(principal.groups ?? []), 'public']);
}

export function canReadAcl(
  entries: readonly AclEntry[],
  principal: FederationPrincipal,
  min: AclLevel = 'read',
): boolean {
  const keys = principalKeys(principal);
  const need = RANK[min];
  for (const e of entries) {
    if (keys.has(e.principal) && RANK[e.level] >= need) return true;
  }
  return false;
}

export function aggregateAcl(
  fragments: Array<{ acl: AccessControlProperties }>,
  at: string,
): AccessControlProperties {
  const seen = new Set<string>();
  const entries: AclEntry[] = [];
  const propertyEntries: NonNullable<AccessControlProperties['propertyEntries']> = {};
  for (const f of fragments) {
    for (const e of f.acl.entries) {
      const key = `${e.principal}:${e.level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...e });
    }
    if (f.acl.propertyEntries) {
      for (const [prop, list] of Object.entries(f.acl.propertyEntries)) {
        const bucket = propertyEntries[prop] ?? [];
        for (const e of list) {
          if (!bucket.some((x) => x.principal === e.principal && x.level === e.level)) {
            bucket.push({ ...e });
          }
        }
        propertyEntries[prop] = bucket;
      }
    }
  }
  return {
    entries,
    propertyEntries: Object.keys(propertyEntries).length > 0 ? propertyEntries : undefined,
    sourceSystemId: 'aggregated',
    retrievedAt: at,
  };
}

export function redactFields(
  fields: Record<string, unknown>,
  acl: AccessControlProperties,
  principal: FederationPrincipal,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const entries = acl.propertyEntries?.[key] ?? acl.entries;
    if (canReadAcl(entries, principal)) properties[key] = value;
  }
  return properties;
}

export function redactTemporaryObject(
  temp: TemporaryObject,
  principal: FederationPrincipal,
): TemporaryObject {
  return {
    ...temp,
    properties: redactFields(temp.properties, temp.acl, principal),
    links: [...temp.links],
    fragments: temp.fragments.map((f) => ({
      ...f,
      rawData: canReadAcl(f.acl.entries, principal)
        ? redactFields(f.rawData, f.acl, principal)
        : { _redacted: true, _reason: 'Insufficient permissions' },
    })),
  };
}
