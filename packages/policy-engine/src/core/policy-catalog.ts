/**
 * Versioned catalog of resources the overlay compiler expands against.
 *
 * WHY: overlay `*` is not an evaluator wildcard. It is compile-time input.
 * A new ObjectType is unauthorized until the next compiled generation.
 */

import type { OntologyRegistry } from 'contracts';

export interface CatalogObjectType {
  ontologyId: string;
  id: string;
}

export interface CatalogLinkType {
  ontologyId: string;
  id: string;
}

export interface CatalogAction {
  ontologyId: string;
  apiName: string;
}

export interface CatalogFunction {
  ontologyId: string;
  id: string;
}

export interface CatalogApproverPolicy {
  ontologyId: string;
  id: string;
}

/**
 * Known resources for one policy generation.
 * Empty object/action lists + overlay `*` ⇒ no object/action nodes (fail-closed).
 */
export interface PolicyResourceCatalog {
  ontologies: string[];
  objectTypes: CatalogObjectType[];
  linkTypes: CatalogLinkType[];
  actions: CatalogAction[];
  functions: CatalogFunction[];
  admin: string[];
  /** Absent in stored JSON is empty (fail-closed). */
  approverPolicies?: CatalogApproverPolicy[];
}

/** Kernel admin/render/ER/catalog resources — always compiled into every generation. */
export const KERNEL_ADMIN_RESOURCES: readonly string[] = [
  'ontology.list',
  'ontology.create',
  'ontology.read',
  'ontology.write',
  'actionType.read',
  'actionType.write',
  'render',
  'function.read',
  'function.execute',
  'er.review.read',
  'er.review.write',
  'er.gold.read',
  'er.gold.write',
  'er.metrics',
  'er.feedback',
  'er.runs',
  'catalog.search',
  'catalog.types',
  'ingest',
  'projection',
  'object-platform',
  'action-execution',
  // WHY: Passo 35 / ADR-0022 — HTTP AIP ask is an admin resource, not a write path.
  'aip-ask',
  // WHY: Passo 36 / ADR-0023 — agent propose path; approve stays on action-execution.
  'aip-agent',
];

export function emptyCatalog(): PolicyResourceCatalog {
  return {
    ontologies: [],
    objectTypes: [],
    linkTypes: [],
    actions: [],
    functions: [],
    admin: [],
    approverPolicies: [],
  };
}

/** True when the stored catalog has no declared resources (kernel admin not yet merged). */
export function isEmptyCatalog(c: PolicyResourceCatalog): boolean {
  return (
    c.ontologies.length === 0 &&
    c.objectTypes.length === 0 &&
    c.linkTypes.length === 0 &&
    c.actions.length === 0 &&
    c.functions.length === 0 &&
    c.admin.length === 0 &&
    (c.approverPolicies?.length ?? 0) === 0
  );
}

export function kernelCatalog(): PolicyResourceCatalog {
  return {
    ...emptyCatalog(),
    admin: [...KERNEL_ADMIN_RESOURCES],
  };
}

export function parsePolicyCatalog(raw: unknown): PolicyResourceCatalog {
  if (raw == null || typeof raw !== 'object') return emptyCatalog();
  const rec = raw as Record<string, unknown>;
  const ontologies = Array.isArray(rec.ontologies)
    ? rec.ontologies.filter((x): x is string => typeof x === 'string')
    : [];
  const objectTypes = Array.isArray(rec.objectTypes)
    ? rec.objectTypes.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const r = row as Record<string, unknown>;
        if (typeof r.ontologyId !== 'string' || typeof r.id !== 'string') return [];
        return [{ ontologyId: r.ontologyId, id: r.id }];
      })
    : [];
  const linkTypes = Array.isArray(rec.linkTypes)
    ? rec.linkTypes.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const r = row as Record<string, unknown>;
        if (typeof r.ontologyId !== 'string' || typeof r.id !== 'string') return [];
        return [{ ontologyId: r.ontologyId, id: r.id }];
      })
    : [];
  const actions = Array.isArray(rec.actions)
    ? rec.actions.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const r = row as Record<string, unknown>;
        if (typeof r.ontologyId !== 'string' || typeof r.apiName !== 'string') return [];
        return [{ ontologyId: r.ontologyId, apiName: r.apiName }];
      })
    : [];
  const functions = Array.isArray(rec.functions)
    ? rec.functions.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const r = row as Record<string, unknown>;
        if (typeof r.ontologyId !== 'string' || typeof r.id !== 'string') return [];
        return [{ ontologyId: r.ontologyId, id: r.id }];
      })
    : [];
  const admin = Array.isArray(rec.admin)
    ? rec.admin.filter((x): x is string => typeof x === 'string')
    : [];
  const approverPolicies = Array.isArray(rec.approverPolicies)
    ? rec.approverPolicies.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const r = row as Record<string, unknown>;
        if (typeof r.ontologyId !== 'string' || typeof r.id !== 'string') return [];
        return [{ ontologyId: r.ontologyId, id: r.id }];
      })
    : [];
  return { ontologies, objectTypes, linkTypes, actions, functions, admin, approverPolicies };
}

export function mergeCatalogs(...cats: PolicyResourceCatalog[]): PolicyResourceCatalog {
  const ontologies = new Set<string>();
  const objectTypes = new Map<string, CatalogObjectType>();
  const linkTypes = new Map<string, CatalogLinkType>();
  const actions = new Map<string, CatalogAction>();
  const functions = new Map<string, CatalogFunction>();
  const admin = new Set<string>();
  const approverPolicies = new Map<string, CatalogApproverPolicy>();
  for (const c of cats) {
    for (const id of c.ontologies) ontologies.add(id);
    for (const t of c.objectTypes) objectTypes.set(`${t.ontologyId}/${t.id}`, t);
    for (const t of c.linkTypes) linkTypes.set(`${t.ontologyId}/${t.id}`, t);
    for (const a of c.actions) actions.set(`${a.ontologyId}/${a.apiName}`, a);
    for (const f of c.functions) functions.set(`${f.ontologyId}/${f.id}`, f);
    for (const a of c.admin) admin.add(a);
    for (const p of c.approverPolicies ?? []) {
      approverPolicies.set(`${p.ontologyId}/${p.id}`, p);
    }
  }
  return {
    ontologies: [...ontologies].sort(),
    objectTypes: [...objectTypes.values()],
    linkTypes: [...linkTypes.values()],
    actions: [...actions.values()],
    functions: [...functions.values()],
    admin: [...admin].sort(),
    approverPolicies: [...approverPolicies.values()],
  };
}

/** Canonical fingerprint so identical catalogs do not bump generation. */
export function catalogFingerprint(c: PolicyResourceCatalog): string {
  const n = mergeCatalogs(c);
  const key = (a: { ontologyId: string; id?: string; apiName?: string }) =>
    `${a.ontologyId}/${a.apiName ?? a.id ?? ''}`;
  return JSON.stringify({
    ontologies: [...n.ontologies].sort(),
    objectTypes: [...n.objectTypes].sort((a, b) => key(a).localeCompare(key(b))),
    linkTypes: [...n.linkTypes].sort((a, b) => key(a).localeCompare(key(b))),
    actions: [...n.actions].sort((a, b) => key(a).localeCompare(key(b))),
    functions: [...n.functions].sort((a, b) => key(a).localeCompare(key(b))),
    admin: [...n.admin].sort(),
    approverPolicies: [...(n.approverPolicies ?? [])].sort((a, b) => key(a).localeCompare(key(b))),
  });
}

export function catalogsEqual(a: PolicyResourceCatalog, b: PolicyResourceCatalog): boolean {
  return catalogFingerprint(a) === catalogFingerprint(b);
}

/**
 * Snapshot of ontology registry contents for overlay compilation.
 */
export async function catalogFromOntology(
  ontology: OntologyRegistry,
): Promise<PolicyResourceCatalog> {
  const cat = emptyCatalog();
  const listed = await ontology.listOntologies();
  for (const o of listed) {
    cat.ontologies.push(o.id);
    const v = await ontology.getLatestVersion(o.id);
    if (!v) continue;
    for (const t of Object.values(v.objectTypes)) {
      cat.objectTypes.push({ ontologyId: o.id, id: t.id });
    }
    for (const t of Object.values(v.linkTypes)) {
      cat.linkTypes.push({ ontologyId: o.id, id: t.id });
    }
    for (const a of Object.values(v.actionTypes)) {
      cat.actions.push({ ontologyId: o.id, apiName: a.apiName ?? a.id });
      const approver = a.approvals?.approverPolicy;
      if (typeof approver === 'string' && approver.length > 0) {
        (cat.approverPolicies ??= []).push({ ontologyId: o.id, id: approver });
      }
    }
    for (const f of Object.values(v.functionTypes)) {
      cat.functions.push({ ontologyId: o.id, id: f.apiName ?? f.id });
    }
  }
  return cat;
}
