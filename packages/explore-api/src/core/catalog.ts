/**
 * explore-api — src/core/catalog.ts
 * Catálogo in-memory de objetos+links para exploração (sem GUI).
 */

import type { LinkRecord, ObjectRecord } from 'contracts';

export interface ExploreCatalog {
  objects: ObjectRecord[];
  links: LinkRecord[];
}

export function objectKey(o: Pick<ObjectRecord, 'objectTypeId' | 'primaryKey'>): string {
  return `${o.objectTypeId}::${o.primaryKey}`;
}

export function neighborsOf(
  catalog: ExploreCatalog,
  from: Pick<ObjectRecord, 'objectTypeId' | 'primaryKey'>,
  linkTypeId?: string,
): ObjectRecord[] {
  const out: ObjectRecord[] = [];
  const seen = new Set<string>();
  for (const e of catalog.links) {
    if (e.deleted) continue;
    if (linkTypeId && e.linkTypeId !== linkTypeId) continue;
    let ot: string;
    let pk: string;
    if (e.sourceObjectTypeId === from.objectTypeId && e.sourcePrimaryKey === from.primaryKey) {
      ot = e.targetObjectTypeId;
      pk = e.targetPrimaryKey;
    } else if (e.targetObjectTypeId === from.objectTypeId && e.targetPrimaryKey === from.primaryKey) {
      ot = e.sourceObjectTypeId;
      pk = e.sourcePrimaryKey;
    } else {
      continue;
    }
    const k = `${ot}::${pk}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const obj = catalog.objects.find((o) => !o.deleted && o.objectTypeId === ot && o.primaryKey === pk);
    if (obj) out.push(obj);
  }
  return out;
}
