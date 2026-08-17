/**
 * knowledge-graph — src/core/redact.ts
 * Redaction: remove nós/propriedades não autorizados e repara arestas soltas.
 *
 * US 9,501,761 — snapshot sanitizado (cópia; grafo vivo intacto).
 * US 9,857,960 — critérios: classificação, proveniência, tipo de objeto, tipo de propriedade.
 */

import {
  assertRedactionRequest,
  assertSanitizedGraph,
  canViewAtLevel,
  resolveClassification,
  type GraphObject,
  type RedactionCriterion,
  type RedactionRequest,
  type RedactedProperty,
  type SanitizedGraph,
  type TypedLink,
} from 'contracts';

function cloneObject(obj: GraphObject): GraphObject {
  return {
    id: obj.id,
    objectTypeId: obj.objectTypeId,
    primaryKey: obj.primaryKey,
    properties: obj.properties ? { ...obj.properties } : undefined,
    deleted: obj.deleted,
    sourceSystem: obj.sourceSystem,
    classification: obj.classification,
    provenance: obj.provenance ? [...obj.provenance] : undefined,
    propertyClassifications: obj.propertyClassifications
      ? { ...obj.propertyClassifications }
      : undefined,
  };
}

function cloneLink(link: TypedLink): TypedLink {
  return { ...link };
}

function matches(value: string | undefined, criterion: RedactionCriterion): boolean {
  if (value === undefined) return false;
  const hit = criterion.values.includes(value);
  return criterion.redactMatching === false ? !hit : hit;
}

function provenanceHits(obj: GraphObject, criterion: RedactionCriterion): boolean {
  const sources = [
    ...(obj.provenance ?? []),
    ...(obj.sourceSystem ? [obj.sourceSystem] : []),
  ];
  const hit = sources.some((s) => criterion.values.includes(s));
  return criterion.redactMatching === false ? !hit && sources.length > 0 : hit;
}

function shouldRedactNode(obj: GraphObject, req: RedactionRequest): boolean {
  if (obj.deleted) return true;
  if (!canViewAtLevel(obj.classification, req.viewingLevel)) return true;
  for (const c of req.criteria ?? []) {
    if (c.kind === 'access_control' && matches(obj.classification, c)) return true;
    if (c.kind === 'object_type' && matches(obj.objectTypeId, c)) return true;
    if (c.kind === 'provenance' && provenanceHits(obj, c)) return true;
  }
  return false;
}

function propertyMarking(
  obj: GraphObject,
  property: string,
  req: RedactionRequest,
): string | undefined {
  return (
    req.propertyClassifications?.[obj.id]?.[property] ??
    obj.propertyClassifications?.[property]
  );
}

function shouldRedactProperty(
  obj: GraphObject,
  property: string,
  req: RedactionRequest,
): boolean {
  const mark = propertyMarking(obj, property, req);
  if (mark && !canViewAtLevel(mark, req.viewingLevel)) return true;
  for (const c of req.criteria ?? []) {
    if (c.kind === 'property_type' && matches(property, c)) return true;
  }
  return false;
}

/**
 * Detecta critérios disponíveis a partir dos metadados do grafo
 * (US 10,222,965 — categorias geradas dos nós; sem GUI).
 */
export function detectRedactionCriteria(objects: readonly GraphObject[]): RedactionCriterion[] {
  const access = new Set<string>();
  const provenance = new Set<string>();
  const objectTypes = new Set<string>();
  const properties = new Set<string>();
  for (const obj of objects) {
    if (obj.classification) access.add(obj.classification);
    if (obj.sourceSystem) provenance.add(obj.sourceSystem);
    for (const p of obj.provenance ?? []) provenance.add(p);
    objectTypes.add(obj.objectTypeId);
    for (const key of Object.keys(obj.properties ?? {})) properties.add(key);
    for (const key of Object.keys(obj.propertyClassifications ?? {})) properties.add(key);
  }
  const out: RedactionCriterion[] = [];
  if (access.size) {
    out.push({ kind: 'access_control', values: [...access].sort(), redactMatching: true });
  }
  if (provenance.size) {
    out.push({ kind: 'provenance', values: [...provenance].sort(), redactMatching: true });
  }
  if (objectTypes.size) {
    out.push({ kind: 'object_type', values: [...objectTypes].sort(), redactMatching: true });
  }
  if (properties.size) {
    out.push({ kind: 'property_type', values: [...properties].sort(), redactMatching: true });
  }
  return out;
}

export function redactGraph(
  objects: readonly GraphObject[],
  links: readonly TypedLink[],
  request: RedactionRequest,
): SanitizedGraph {
  assertRedactionRequest(request);
  const viewing = resolveClassification(request.viewingLevel).name;

  const redactedNodeIds: string[] = [];
  const kept = new Map<string, GraphObject>();
  const redactedProperties: RedactedProperty[] = [];

  for (const raw of objects) {
    if (shouldRedactNode(raw, request)) {
      redactedNodeIds.push(raw.id);
      continue;
    }
    const obj = cloneObject(raw);
    const props = obj.properties ?? {};
    const stripped: string[] = [];
    for (const key of Object.keys(props)) {
      if (shouldRedactProperty(obj, key, request)) {
        delete props[key];
        stripped.push(key);
      }
    }
    if (obj.propertyClassifications) {
      for (const key of stripped) delete obj.propertyClassifications[key];
    }
    if (stripped.length) {
      obj.properties = props;
      for (const property of stripped) redactedProperties.push({ objectId: obj.id, property });
    }
    kept.set(obj.id, obj);
  }

  const redactedLinkIds: string[] = [];
  const keptLinks: TypedLink[] = [];
  for (const link of links) {
    if (!kept.has(link.sourceObjectId) || !kept.has(link.targetObjectId)) {
      redactedLinkIds.push(link.id);
      continue;
    }
    keptLinks.push(cloneLink(link));
  }

  const sanitized: SanitizedGraph = {
    viewingLevel: viewing,
    nodes: [...kept.values()],
    links: keptLinks,
    redactedNodeIds,
    redactedLinkIds,
    redactedProperties,
  };

  const integrity = assertSanitizedGraph(sanitized);
  if (!integrity.ok) {
    throw new Error(
      `redactGraph: arestas quebradas: ${integrity.issues.map((i) => i.detail).join('; ')}`,
    );
  }
  return sanitized;
}

export function sanitizedContainsValue(graph: SanitizedGraph, secret: string): boolean {
  return JSON.stringify(graph.nodes).includes(secret);
}
