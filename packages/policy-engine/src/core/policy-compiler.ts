/**
 * Compile a declarative overlay + resource catalog into EPID nodes/grants.
 *
 * Invariants:
 * - Overlay `*` is expanded here, never at authorize time.
 * - Explicit grant names not in the catalog are synthesized under KERNEL_ONTOLOGY
 *   so fixture compilers stay usable without an ontology registry.
 * - Output node ids are prefixed `ovl-` so native EPID rows can coexist.
 *
 * Failure mode: empty catalog + only wildcards ⇒ no object/action nodes ⇒ deny.
 */

import type { PolicyNode } from 'contracts';

import {
  emptyCatalog,
  kernelCatalog,
  mergeCatalogs,
  type CatalogAction,
  type CatalogApproverPolicy,
  type CatalogFunction,
  type CatalogLinkType,
  type CatalogObjectType,
  type PolicyResourceCatalog,
} from './policy-catalog.js';
import {
  type OverlayOp,
  type PolicyOverlay,
} from './policy-overlay.js';
import type { PolicyEpidTuple } from './policy-store.js';
import { KERNEL_ONTOLOGY, qualifyResource, ResourceIds } from './resource-ids.js';

/** Sentinel principal that receives everyoneRole grants. Engine unions these EPIDs. */
export const EVERYONE_PRINCIPAL = '*';

const COMPILED_PREFIX = 'ovl-';

export function isCompiledNodeId(id: string): boolean {
  return id.startsWith(COMPILED_PREFIX);
}

export function isCompiledPolicy(policy: string): boolean {
  return policy.startsWith(COMPILED_PREFIX);
}

export interface CompiledEpid {
  grants: Array<{ principal: string; policy: string }>;
  nodes: PolicyNode[];
  epids: PolicyEpidTuple[];
}

function listMatches(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return false;
  return list.includes('*') || list.includes(value);
}

function opsOf(grant: { operations?: OverlayOp[] }): OverlayOp[] {
  return grant.operations && grant.operations.length > 0 ? grant.operations : ['read'];
}

function implicitFromOverlay(overlay: PolicyOverlay): PolicyResourceCatalog {
  const cat = emptyCatalog();
  const ontologies = new Set<string>();
  for (const g of overlay.grants) {
    const namedOntologies = (g.ontologyIds ?? []).filter((id) => id !== '*');
    // WHY: omitted ontologyIds stay on KERNEL_ONTOLOGY (fail-closed, never cross-ontology).
    const targets = namedOntologies.length > 0 ? namedOntologies : [KERNEL_ONTOLOGY];
    for (const id of namedOntologies) ontologies.add(id);
    for (const ontologyId of targets) {
      for (const t of g.objectTypes ?? []) {
        if (t !== '*') cat.objectTypes.push({ ontologyId, id: t });
      }
      for (const a of g.actions ?? []) {
        if (a !== '*') cat.actions.push({ ontologyId, apiName: a });
      }
      for (const t of g.linkTypes ?? []) {
        if (t !== '*') cat.linkTypes.push({ ontologyId, id: t });
      }
      for (const f of g.functions ?? []) {
        if (f !== '*') cat.functions.push({ ontologyId, id: f });
      }
      for (const p of g.approverPolicies ?? []) {
        if (p !== '*') (cat.approverPolicies ??= []).push({ ontologyId, id: p });
      }
    }
  }
  for (const id of ontologies) cat.ontologies.push(id);
  return cat;
}

function scopedOntologyIds(catalog: PolicyResourceCatalog, grant: { ontologyIds?: string[] }): Set<string> {
  const selector = grant.ontologyIds;
  if (!selector || selector.length === 0) return new Set([KERNEL_ONTOLOGY]);
  if (selector.includes('*')) return new Set(catalog.ontologies.length > 0 ? catalog.ontologies : [KERNEL_ONTOLOGY]);
  return new Set(selector);
}

function inOntology<T extends { ontologyId: string }>(rows: T[], ontologies: Set<string>): T[] {
  return rows.filter((r) => ontologies.has(r.ontologyId));
}

function expandObjectTypes(
  catalog: PolicyResourceCatalog,
  selector: string[] | undefined,
): CatalogObjectType[] {
  if (!selector || selector.length === 0) return [];
  if (selector.includes('*')) return [...catalog.objectTypes];
  const wanted = new Set(selector);
  return catalog.objectTypes.filter((t) => wanted.has(t.id));
}

function expandLinkTypes(
  catalog: PolicyResourceCatalog,
  selector: string[] | undefined,
): CatalogLinkType[] {
  if (!selector || selector.length === 0) return [];
  if (selector.includes('*')) return [...catalog.linkTypes];
  const wanted = new Set(selector);
  return catalog.linkTypes.filter((t) => wanted.has(t.id));
}

function expandActions(
  catalog: PolicyResourceCatalog,
  selector: string[] | undefined,
): CatalogAction[] {
  if (!selector || selector.length === 0) return [];
  if (selector.includes('*')) return [...catalog.actions];
  const wanted = new Set(selector);
  return catalog.actions.filter((a) => wanted.has(a.apiName));
}

function expandFunctions(
  catalog: PolicyResourceCatalog,
  selector: string[] | undefined,
): CatalogFunction[] {
  if (!selector || selector.length === 0) return [];
  if (selector.includes('*')) return [...catalog.functions];
  const wanted = new Set(selector);
  return catalog.functions.filter((f) => wanted.has(f.id));
}

function expandAdmin(catalog: PolicyResourceCatalog, selector: string[] | undefined): string[] {
  if (!selector || selector.length === 0) return [];
  if (selector.includes('*')) return [...catalog.admin];
  const wanted = new Set(selector);
  return catalog.admin.filter((a) => wanted.has(a));
}

function expandApprovers(
  catalog: PolicyResourceCatalog,
  selector: string[] | undefined,
  ontologies: Set<string>,
): CatalogApproverPolicy[] {
  if (!selector || selector.length === 0) return [];
  const rows = inOntology(catalog.approverPolicies ?? [], ontologies);
  if (selector.includes('*')) return rows;
  const wanted = new Set(selector);
  return rows.filter((p) => wanted.has(p.id));
}

/**
 * Compile overlay grants into EPID rows. Kernel admin resources are always in the catalog.
 */
export function compileOverlayToEpid(
  overlay: PolicyOverlay,
  catalog: PolicyResourceCatalog,
): CompiledEpid {
  const effective = mergeCatalogs(kernelCatalog(), implicitFromOverlay(overlay), catalog);

  const coverage = new Map<string, { resource: string; op: OverlayOp; principals: Set<string> }>();

  function cover(resource: string, op: OverlayOp, principals: Iterable<string>): void {
    const qualified = qualifyResource(resource, op);
    let row = coverage.get(qualified);
    if (!row) {
      row = { resource: qualified, op, principals: new Set() };
      coverage.set(qualified, row);
    }
    for (const p of principals) row.principals.add(p);
  }

  const everyone = overlay.everyoneRole;

  function principalsForRole(role: string): string[] {
    const out: string[] = [];
    if (everyone === role) out.push(EVERYONE_PRINCIPAL);
    for (const [principal, roles] of Object.entries(overlay.roles)) {
      if (roles.includes(role)) out.push(principal);
    }
    return out;
  }

  for (const grant of overlay.grants) {
    const principals = principalsForRole(grant.role);
    if (principals.length === 0) continue;
    const ops = opsOf(grant);
    const ontologies = scopedOntologyIds(effective, grant);

    for (const t of inOntology(expandObjectTypes(effective, grant.objectTypes), ontologies)) {
      const resource = ResourceIds.objectType(t.ontologyId, t.id);
      for (const op of ops) cover(resource, op, principals);
      if (ops.includes('read')) cover(ResourceIds.ontology(t.ontologyId), 'read', principals);
    }
    for (const t of inOntology(expandLinkTypes(effective, grant.linkTypes), ontologies)) {
      const resource = ResourceIds.linkType(t.ontologyId, t.id);
      for (const op of ops) cover(resource, op, principals);
    }
    for (const a of inOntology(expandActions(effective, grant.actions), ontologies)) {
      const resource = ResourceIds.action(a.ontologyId, a.apiName);
      cover(resource, 'read', principals);
      cover(resource, 'modify', principals);
    }
    for (const f of inOntology(expandFunctions(effective, grant.functions), ontologies)) {
      const resource = ResourceIds.function(f.ontologyId, f.id);
      cover(resource, 'read', principals);
      cover(resource, 'modify', principals);
    }
    for (const name of expandAdmin(effective, grant.adminResources)) {
      const resource = ResourceIds.admin(name);
      cover(resource, 'read', principals);
      cover(resource, 'modify', principals);
    }
    const approvers = expandApprovers(effective, grant.approverPolicies, ontologies);
    if (approvers.length > 0 || (grant.approverPolicies && grant.approverPolicies.length > 0)) {
      // WHY: HTTP approve/reject is gated on admin:action-execution; the executor
      // still requires ResourceIds.approver(ontology, name).
      cover(ResourceIds.admin('action-execution'), 'modify', principals);
    }
    for (const p of approvers) {
      const resource = ResourceIds.approver(p.ontologyId, p.id);
      cover(resource, 'read', principals);
      cover(resource, 'modify', principals);
    }
    if (listMatches(grant.adminResources, 'ontology.write') || listMatches(grant.adminResources, '*')) {
      for (const id of ontologies) {
        cover(ResourceIds.ontology(id), 'modify', principals);
      }
    }
  }

  const grants: CompiledEpid['grants'] = [];
  const nodes: PolicyNode[] = [];
  const epids: PolicyEpidTuple[] = [];
  const seenEpid = new Set<string>();

  for (const [qualified, row] of coverage) {
    const policy = `${COMPILED_PREFIX}${qualified}`;
    const epid = `${COMPILED_PREFIX}e:${qualified}`;
    const nodeId = `${COMPILED_PREFIX}n:${qualified}`;
    nodes.push({
      id: nodeId,
      resourceId: qualified,
      policy,
      parentId: null,
      epid,
    });
    if (!seenEpid.has(epid)) {
      epids.push({ epid, policy, parentId: null });
      seenEpid.add(epid);
    }
    for (const principal of row.principals) {
      grants.push({ principal, policy });
    }
  }

  return { grants, nodes, epids };
}

export function mergeNativeAndCompiled(
  native: {
    grants: Array<{ principal: string; policy: string }>;
    nodes: PolicyNode[];
    epids: PolicyEpidTuple[];
  },
  compiled: CompiledEpid,
): CompiledEpid {
  return {
    grants: [
      ...native.grants.filter((g) => !isCompiledPolicy(g.policy)),
      ...compiled.grants,
    ],
    nodes: [...native.nodes.filter((n) => !isCompiledNodeId(n.id)), ...compiled.nodes],
    epids: [
      ...native.epids.filter((e) => !isCompiledPolicy(e.policy)),
      ...compiled.epids,
    ],
  };
}
