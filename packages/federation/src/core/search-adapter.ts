/**
 * federation — src/core/search-adapter.ts
 * Adapta TemporaryObject → SearchDocument para o planner do query-api.
 */

import type {
  FederationPrincipal,
  SearchDocument,
  SearchPrincipal,
  SearchQuery,
  TemporaryObject,
} from 'contracts';

import type { FederationEngine } from './engine.js';

export function temporaryToSearchDocument(temp: TemporaryObject): SearchDocument {
  const latest = temp.fragments.reduce(
    (acc, f) => (f.lastUpdated > acc ? f.lastUpdated : acc),
    temp.expiresAt,
  );
  return {
    id: temp.id,
    objectTypeId: temp.objectTypeId,
    primaryKey: temp.id,
    properties: { ...temp.properties },
    aclPrincipals: temp.acl.entries.map((e) => e.principal),
    classification: 'Unclassified',
    sourceUpdatedAt: latest,
  };
}

export function asFederationPrincipal(p: SearchPrincipal): FederationPrincipal {
  return { id: p.id, groups: p.groups, viewingLevel: p.viewingLevel };
}

export function createFederateAdapter(
  engine: FederationEngine,
): (query: SearchQuery, principal: SearchPrincipal) => SearchDocument[] {
  return (query, principal) => {
    const objectId = query.federate?.objectId;
    const fedQuery = {
      objectId,
      sourceIds: query.federate?.sourceIds,
      scriptId: query.federate?.scriptId,
      requirePushdown: true,
    };
    const views = engine.execute(fedQuery, asFederationPrincipal(principal));
    return views.map(temporaryToSearchDocument);
  };
}
