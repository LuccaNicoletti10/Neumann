/**
 * federation — src/core/planner.ts
 * Decompõe FederationQuery em PushdownSpec por fonte (US 10,402,397).
 */

import type {
  FederationPlan,
  FederationQuery,
  FederationSourceCatalogEntry,
  PushdownPredicate,
  PushdownSpec,
} from 'contracts';

export function planFederation(
  query: FederationQuery,
  catalog: readonly FederationSourceCatalogEntry[],
): FederationPlan {
  const scriptId = query.scriptId ?? 'default';
  const sources = query.sourceIds?.length
    ? catalog.filter((s) => query.sourceIds!.includes(s.sourceId))
    : [...catalog];
  const objectTypeId = query.objectTypeId ?? sources[0]?.objectTypeId ?? 'ot.unknown';
  const predicates = query.predicates ?? [];

  const pushdowns: FederationPlan['pushdowns'] = [];
  for (const src of sources) {
    const fieldSet = new Set(src.fields);
    const local: PushdownPredicate[] = predicates.filter((p) => fieldSet.has(p.field));
    const hasPk = Boolean(query.objectId);
    const hasLocalPred = local.length > 0;
    if (query.requirePushdown && !hasPk && !hasLocalPred) continue;

    const spec: PushdownSpec = {
      object: { sourceSystem: src.sourceId, objectName: src.objectName },
      columns: [...src.fields],
    };
    if (query.objectId) spec.primaryKeys = [query.objectId];
    if (hasLocalPred) spec.predicates = local;
    pushdowns.push({ sourceId: src.sourceId, spec });
  }

  return {
    objectId: query.objectId,
    objectTypeId,
    scriptId,
    pushdowns,
  };
}
