/**
 * explore-api — src/core/pattern.ts
 * Executa GraphPattern (US 8,799,240) — join de nós/arestas, sem GUI.
 */

import {
  assertGraphPattern,
  type GraphPattern,
  type GraphPatternBinding,
  type GraphPatternMatch,
  type GraphPatternResult,
  type GraphPropertyMatch,
  type ObjectRecord,
} from 'contracts';
import type { OntologyAuthorizer } from 'policy-engine';

import { neighborsOf, type ExploreCatalog } from './catalog.js';

function matchProperty(obj: ObjectRecord, m: GraphPropertyMatch): boolean {
  const raw = obj.properties[m.property];
  const op = m.operator;
  if (op === 'eq') return raw === m.value;
  if (op === 'ne') return raw !== m.value;
  if (raw === undefined || raw === null || m.value === null) return false;
  if (op === 'contains') return String(raw).includes(String(m.value));
  if (op === 'startsWith') return String(raw).startsWith(String(m.value));
  if (op === 'endsWith') return String(raw).endsWith(String(m.value));
  const a = Number(raw);
  const b = Number(m.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (op === 'gt') return a > b;
  if (op === 'lt') return a < b;
  if (op === 'gte') return a >= b;
  if (op === 'lte') return a <= b;
  return false;
}

function nodeOk(
  obj: ObjectRecord,
  node: GraphPattern['nodes'][number],
  principal: string,
  authorizer?: OntologyAuthorizer,
): boolean {
  if (obj.deleted) return false;
  if (obj.objectTypeId !== node.objectTypeId) return false;
  if (node.primaryKey && obj.primaryKey !== node.primaryKey) return false;
  if (authorizer && !authorizer.canReadObjectType(principal, obj.objectTypeId)) return false;
  for (const m of node.matches ?? []) {
    if (!matchProperty(obj, m)) return false;
  }
  return true;
}

function redact(
  obj: ObjectRecord,
  principal: string,
  authorizer?: OntologyAuthorizer,
): GraphPatternBinding {
  const props = authorizer
    ? (authorizer.redactProperties(principal, obj.objectTypeId, obj.properties) as Record<
        string,
        unknown
      >)
    : { ...obj.properties };
  return {
    nodeId: '',
    objectTypeId: obj.objectTypeId,
    primaryKey: obj.primaryKey,
    id: obj.id,
    properties: props,
  };
}

function orGroups(pattern: GraphPattern): Set<string>[] {
  const groups: Set<string>[] = [];
  for (const b of pattern.branches ?? []) {
    if (b.type === 'OR') groups.push(new Set(b.edgeIds));
  }
  return groups;
}

export interface ExecutePatternOptions {
  catalog: ExploreCatalog;
  pattern: GraphPattern;
  principal: string;
  authorizer?: OntologyAuthorizer;
  limit?: number;
}

export function executeGraphPattern(opts: ExecutePatternOptions): GraphPatternResult {
  assertGraphPattern(opts.pattern);
  const { catalog, pattern, principal, authorizer } = opts;
  const limit = opts.limit ?? 200;
  const byId = new Map(pattern.nodes.map((n) => [n.id, n]));
  const root = byId.get(pattern.rootNodeId)!;
  const orSets = orGroups(pattern);

  const roots = catalog.objects.filter((o) => nodeOk(o, root, principal, authorizer));
  const matches: GraphPatternMatch[] = [];

  function emit(bound: Map<string, ObjectRecord>): void {
    if (matches.length >= limit) return;
    const bindings: GraphPatternBinding[] = [];
    for (const [nodeId, obj] of bound) {
      const row = redact(obj, principal, authorizer);
      row.nodeId = nodeId;
      bindings.push(row);
    }
    matches.push({ bindings });
  }

  function unusedEdges(bound: Map<string, ObjectRecord>, used: Set<string>) {
    return pattern.edges.filter((e) => {
      if (used.has(e.id)) return false;
      return bound.has(e.source) && !bound.has(e.target);
    });
  }

  function expand(bound: Map<string, ObjectRecord>, used: Set<string>): void {
    if (matches.length >= limit) return;
    const pending = unusedEdges(bound, used);
    if (pending.length === 0) {
      emit(bound);
      return;
    }

    const edge = pending[0]!;
    const from = bound.get(edge.source)!;
    const targetNode = byId.get(edge.target);
    if (!targetNode) return;

    const neigh = neighborsOf(catalog, from, edge.linkTypeId).filter((o) =>
      nodeOk(o, targetNode, principal, authorizer),
    );

    const orGroup = orSets.find((g) => g.has(edge.id));
    if (orGroup) {
      const groupEdges = pattern.edges.filter((e) => orGroup.has(e.id) && !used.has(e.id));
      let any = false;
      for (const ge of groupEdges) {
        const tNode = byId.get(ge.target);
        if (!tNode) continue;
        const src = bound.get(ge.source);
        if (!src) continue;
        const cand = neighborsOf(catalog, src, ge.linkTypeId).filter((o) =>
          nodeOk(o, tNode, principal, authorizer),
        );
        for (const n of cand) {
          any = true;
          const nextBound = new Map(bound);
          nextBound.set(ge.target, n);
          const nextUsed = new Set(used);
          for (const x of groupEdges) nextUsed.add(x.id);
          expand(nextBound, nextUsed);
        }
      }
      if (!any) {
        const allOptional = groupEdges.every((e) => e.optional);
        if (allOptional) {
          const nextUsed = new Set(used);
          for (const x of groupEdges) nextUsed.add(x.id);
          expand(bound, nextUsed);
        }
      }
      return;
    }

    if (neigh.length === 0) {
      if (edge.optional) {
        const nextUsed = new Set(used);
        nextUsed.add(edge.id);
        expand(bound, nextUsed);
      }
      return;
    }

    for (const n of neigh) {
      const nextBound = new Map(bound);
      nextBound.set(edge.target, n);
      const nextUsed = new Set(used);
      nextUsed.add(edge.id);
      expand(nextBound, nextUsed);
    }
  }

  for (const r of roots) {
    const bound = new Map<string, ObjectRecord>([[root.id, r]]);
    expand(bound, new Set());
    if (matches.length >= limit) break;
  }

  return { matches, total: matches.length };
}
