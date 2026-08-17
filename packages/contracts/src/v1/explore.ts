/**
 * contracts — src/v1/explore.ts
 * APIs de exploração genéricas (Passo 30). Shape congelado.
 *
 * US 8,799,240 — exploração em larga escala (padrão de grafo + índice em blocos).
 * US 9,639,580 — scoring ponderado de objetos (sem mapa/GUI).
 * US 9,280,532 / US 9,880,993 — acesso a rich objects via path (sem spreadsheet UI).
 *
 * Kernel: sem app vertical, sem GUI, sem Meilisearch obrigatório.
 */

import type { LinkTypeId, ObjectTypeId } from './ontology.js';
import type { PrincipalId } from './policy.js';

export type GraphMatchOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'endsWith';

export interface GraphPropertyMatch {
  property: string;
  operator: GraphMatchOperator;
  value: string | number | boolean | null;
}

export interface GraphPatternNode {
  id: string;
  objectTypeId: ObjectTypeId | string;
  primaryKey?: string;
  matches?: GraphPropertyMatch[];
}

export interface GraphPatternEdge {
  id: string;
  source: string;
  target: string;
  linkTypeId?: LinkTypeId | string;
  optional?: boolean;
}

export interface GraphPatternBranch {
  type: 'AND' | 'OR';
  edgeIds: string[];
}

/** Query de padrão no grafo (visual query sem visual). */
export interface GraphPattern {
  nodes: GraphPatternNode[];
  edges: GraphPatternEdge[];
  rootNodeId: string;
  branches?: GraphPatternBranch[];
}

export interface GraphPatternBinding {
  nodeId: string;
  objectTypeId: string;
  primaryKey: string;
  id: string;
  properties: Record<string, unknown>;
}

export interface GraphPatternMatch {
  bindings: GraphPatternBinding[];
}

export interface GraphPatternResult {
  matches: GraphPatternMatch[];
  total: number;
}

export type InvestigationBlockStrategy = 'entity' | 'byteCount' | 'combined';

export type TokenTransform =
  | { type: 'canonicalize'; toLower?: boolean }
  | { type: 'truncate'; maxLength: number }
  | { type: 'lookup'; dictionary: Record<string, string> }
  | { type: 'concatenate'; delimiter?: string };

export interface InvestigationIndexHit {
  objectId: string;
  objectTypeId: string;
  primaryKey: string;
  snippet: string;
}

export interface InvestigationSearchResult {
  hits: InvestigationIndexHit[];
  total: number;
  level: 'single' | 'two';
}

export interface ExploreMetric {
  id: string;
  name: string;
  sourceFields: string[];
  /** Score 0–100 a partir dos campos numéricos. */
  defaultWeight: number;
}

export interface ExploreMetricSelection {
  metricId: string;
  weight: number;
}

export interface ExploreObjectScore {
  objectId: string;
  primaryKey: string;
  objectTypeId: string;
  metrics: Record<string, { rawValue: number; weightedValue: number }>;
  totalUnweighted: number;
  totalWeighted: number;
  rank: number;
}

export interface ExploreScoreResult {
  scores: ExploreObjectScore[];
}

export interface ObjectSlot {
  id: string;
  objectTypeId: string;
  primaryKey: string;
  objectId: string;
}

export interface BindingEvalResult {
  expression: string;
  resolved: string;
  value: unknown;
  dependencies: string[];
}

export interface ExplorePrincipal {
  id: PrincipalId;
  groups?: string[];
}

export function buildGoldenGraphPattern(): GraphPattern {
  return {
    rootNodeId: 'c',
    nodes: [
      { id: 'c', objectTypeId: 'ot.customer' },
      { id: 'o', objectTypeId: 'ot.sales_order', matches: [{ property: 'status', operator: 'eq', value: 'open' }] },
    ],
    edges: [{ id: 'e1', source: 'c', target: 'o', linkTypeId: 'lt.placed' }],
  };
}

export function assertGraphPattern(p: GraphPattern): void {
  if (!p.rootNodeId) throw new Error('GraphPattern: rootNodeId obrigatório');
  if (!Array.isArray(p.nodes) || p.nodes.length === 0) {
    throw new Error('GraphPattern: nodes[] obrigatório');
  }
  if (!p.nodes.some((n) => n.id === p.rootNodeId)) {
    throw new Error('GraphPattern: rootNodeId deve existir em nodes');
  }
  if (!Array.isArray(p.edges)) throw new Error('GraphPattern: edges[] obrigatório');
}
