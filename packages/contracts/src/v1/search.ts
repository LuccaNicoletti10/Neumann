/**
 * contracts — src/v1/search.ts
 * Query API + índice permission-aware (Passo 29). Shape congelado.
 *
 * US 9,031,981 / US 9,798,768 — Search Around (1 hop via grafo, sem GUI visual).
 * US 8,868,537 — busca unificada: planner escolhe backend.
 * US 9,262,529 — caixa única → query estruturada (sem UI web).
 * US 10,726,032 — search template = ObjectSetFilter parametrizado + policy.
 * US 9,619,557 — key-phrases sobre texto autorizado (sem corpus GUI).
 * US 8,041,714 / US 8,280,880 — filter chains = ObjectSetFilter AST.
 * US 11,238,102 — NL → filtro estruturado (sem LLM).
 *
 * Federation (Passo 31) entra como backend `federation` quando `federate` está setado.
 */

import type { ObjectSetFilter } from './object-set.js';
import type { LinkTypeId, ObjectTypeId } from './ontology.js';

export type SearchBackend = 'search-index' | 'object-store' | 'graph' | 'federation';

/** Roteia o planner para pushdown (Passo 31). */
export interface FederateSpec {
  objectId?: string;
  sourceIds?: string[];
  scriptId?: string;
}

export type SearchSurface =
  | 'hit'
  | 'autocomplete'
  | 'facet'
  | 'suggestion'
  | 'snippet'
  | 'ranking';

/** Documento no índice — ACL + classificação no próprio doc (fail-closed). */
export interface SearchDocument {
  id: string;
  objectTypeId: ObjectTypeId | string;
  primaryKey: string;
  properties: Record<string, unknown>;
  /**
   * Principals/grupos com leitura. Lista vazia = ninguém vê.
   */
  aclPrincipals: string[];
  classification?: string;
  /** Marcação colunar/property (Passo 27) — strip no hit. */
  propertyClassifications?: Record<string, string>;
  sourceUpdatedAt: string;
  indexedAt?: string;
}

export interface SearchPrincipal {
  id: string;
  groups?: string[];
  viewingLevel: string;
}

export interface SearchAroundSpec {
  objectId: string;
  linkTypeId?: LinkTypeId | string;
  maxHops?: number;
}

export interface SearchQuery {
  q?: string;
  objectTypeIds?: string[];
  filter?: ObjectSetFilter;
  searchAround?: SearchAroundSpec;
  facetFields?: string[];
  limit?: number;
  templateId?: string;
  templateParams?: Record<string, unknown>;
  /** Quando presente, o planner escolhe o backend federation. */
  federate?: FederateSpec;
}

export interface SearchHit {
  id: string;
  objectTypeId: string;
  primaryKey: string;
  properties: Record<string, unknown>;
  score: number;
  snippet?: string;
}

export interface SearchFacetValue {
  value: string;
  count: number;
}

export interface SearchFacet {
  field: string;
  values: SearchFacetValue[];
}

export interface SearchSuggestion {
  text: string;
  kind: 'object' | 'property' | 'token';
  score: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Count só do conjunto autorizado — nunca do universo negado. */
  total: number;
  facets: SearchFacet[];
  suggestions: SearchSuggestion[];
  autocomplete: SearchSuggestion[];
  metadata: {
    backend: SearchBackend;
    tookMs: number;
    /** max(indexedAt − sourceUpdatedAt) nos docs tocados. */
    freshnessLagMs: number;
  };
}

/** Template nomeado: filtro parametrizado ($status) + viewing mínimo. */
export interface SearchTemplate {
  id: string;
  name: string;
  objectTypeId: string;
  filter: ObjectSetFilter;
  viewingLevel?: string;
}

export interface SearchLink {
  id: string;
  linkTypeId: string;
  sourceObjectId: string;
  targetObjectId: string;
}

export function buildGoldenSearchDocument(): SearchDocument {
  return {
    id: 'obj-c1',
    objectTypeId: 'ot.customer',
    primaryKey: 'C1',
    properties: { name: 'Acme' },
    aclPrincipals: ['alice', 'analysts'],
    classification: 'Unclassified',
    sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
    indexedAt: '2024-06-01T12:00:01.000Z',
  };
}

export function assertSearchQuery(q: SearchQuery): void {
  if (q.limit !== undefined && (!Number.isFinite(q.limit) || q.limit < 1)) {
    throw new Error('SearchQuery: limit inválido');
  }
}

export function assertSearchDocument(doc: SearchDocument): void {
  if (!doc.id) throw new Error('SearchDocument: id obrigatório');
  if (!doc.objectTypeId) throw new Error('SearchDocument: objectTypeId obrigatório');
  if (!doc.primaryKey) throw new Error('SearchDocument: primaryKey obrigatório');
  if (!Array.isArray(doc.aclPrincipals)) {
    throw new Error('SearchDocument: aclPrincipals[] obrigatório');
  }
  if (!doc.sourceUpdatedAt) throw new Error('SearchDocument: sourceUpdatedAt obrigatório');
}
