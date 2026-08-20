/**
 * RBAC overlay compiled into a PolicyRuntime snapshot generation.
 *
 * This is compiler input (and durable JSON), not a second evaluator API.
 * Evaluation lives in PolicyRuntime against a frozen generation.
 */

import { canViewAtLevel } from 'contracts';

import { KERNEL_ONTOLOGY } from './resource-ids.js';

export type OverlayOp = 'read' | 'modify';

export interface OntologyGrant {
  role: string;
  /**
   * Ontologies this grant applies to. Omitted/empty → KERNEL_ONTOLOGY only
   * (fail-closed; never shares an id across two ontologies).
   */
  ontologyIds?: string[];
  objectTypes?: string[];
  linkTypes?: string[];
  actions?: string[];
  functions?: string[];
  adminResources?: string[];
  /** Approval policies compiled to ResourceIds.approver. */
  approverPolicies?: string[];
  /** Operations on object/link types. Default: ['read']. */
  operations?: OverlayOp[];
  /** Properties hidden for this grant's objectTypes in the selected ontologies. */
  hiddenProperties?: string[];
}

/**
 * Durable RBAC + classification + field masks.
 * Empty roles/grants = deny (fail-closed).
 */
export interface PolicyOverlay {
  roles: Record<string, string[]>;
  grants: OntologyGrant[];
  everyoneRole?: string;
  maxClassification?: Record<string, string>;
}

export const EMPTY_POLICY_OVERLAY: PolicyOverlay = Object.freeze({
  roles: {},
  grants: [],
});

/** Named test/demo fixture — never an implicit default. */
export const ALLOW_ALL_POLICY_OVERLAY: PolicyOverlay = Object.freeze({
  everyoneRole: 'world',
  roles: {},
  grants: [
    {
      role: 'world',
      ontologyIds: ['*'],
      objectTypes: ['*'],
      linkTypes: ['*'],
      actions: ['*'],
      functions: ['*'],
      adminResources: ['*'],
      approverPolicies: ['*'],
      operations: ['read', 'modify'] as OverlayOp[],
    },
  ],
});

export const DENY_ALL_POLICY_OVERLAY: PolicyOverlay = EMPTY_POLICY_OVERLAY;

function matches(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return false;
  return list.includes('*') || list.includes(value);
}

function isOverlay(value: unknown): value is PolicyOverlay {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.roles === 'object' && rec.roles !== null && Array.isArray(rec.grants);
}

/**
 * Parse overlay JSON from the store. `{}` (SQL default) is deny-all, not allow-all.
 */
function copyList(list: string[] | undefined): string[] | undefined {
  return list ? [...list] : undefined;
}

export function parsePolicyOverlay(raw: unknown): PolicyOverlay {
  if (raw == null) return EMPTY_POLICY_OVERLAY;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '{}') return EMPTY_POLICY_OVERLAY;
    try {
      return parsePolicyOverlay(JSON.parse(trimmed) as unknown);
    } catch {
      throw new Error('policy overlay JSON is invalid');
    }
  }
  if (typeof raw === 'object' && raw !== null && Object.keys(raw as object).length === 0) {
    return EMPTY_POLICY_OVERLAY;
  }
  if (!isOverlay(raw)) {
    throw new Error('policy overlay shape is invalid');
  }
  return {
    roles: { ...raw.roles },
    grants: raw.grants.map((g) => ({
      role: g.role,
      ontologyIds: copyList(g.ontologyIds),
      objectTypes: copyList(g.objectTypes),
      linkTypes: copyList(g.linkTypes),
      actions: copyList(g.actions),
      functions: copyList(g.functions),
      adminResources: copyList(g.adminResources),
      approverPolicies: copyList(g.approverPolicies),
      operations: g.operations ? [...g.operations] : undefined,
      hiddenProperties: copyList(g.hiddenProperties),
    })),
    everyoneRole: raw.everyoneRole,
    maxClassification: raw.maxClassification ? { ...raw.maxClassification } : undefined,
  };
}

export function cloneOverlay(overlay: PolicyOverlay): PolicyOverlay {
  return parsePolicyOverlay(overlay);
}

export function overlayRolesOf(overlay: PolicyOverlay, principal: string): string[] {
  const base = overlay.roles[principal] ?? [];
  return overlay.everyoneRole ? [...base, overlay.everyoneRole] : base;
}

export function overlayGrantsFor(overlay: PolicyOverlay, principal: string): OntologyGrant[] {
  const roles = new Set(overlayRolesOf(overlay, principal));
  return overlay.grants.filter((g) => roles.has(g.role));
}

export function overlayRedactProperties<T extends Record<string, unknown>>(
  overlay: PolicyOverlay,
  principal: string,
  objectTypeId: string,
  properties: T,
  ontologyId: string = KERNEL_ONTOLOGY,
): Partial<T> {
  const hidden = new Set<string>();
  for (const g of overlayGrantsFor(overlay, principal)) {
    if (!ontologyInGrant(g, ontologyId)) continue;
    if (matches(g.objectTypes, objectTypeId)) {
      for (const p of g.hiddenProperties ?? []) hidden.add(p);
    }
  }
  if (hidden.size === 0) return { ...properties };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (!hidden.has(k)) out[k] = v;
  }
  return out as Partial<T>;
}

function ontologyInGrant(grant: OntologyGrant, ontologyId: string): boolean {
  const ids = grant.ontologyIds;
  if (!ids || ids.length === 0) return ontologyId === KERNEL_ONTOLOGY;
  return ids.includes('*') || ids.includes(ontologyId);
}

export function overlayFilterReadable<T extends { objectTypeId: string; ontologyId?: string }>(
  overlay: PolicyOverlay,
  principal: string,
  records: readonly T[],
): T[] {
  const max = overlay.maxClassification?.[principal];
  const grants = overlayGrantsFor(overlay, principal);
  return records.filter((r) => {
    const ontologyId =
      typeof r.ontologyId === 'string' && r.ontologyId.length > 0 ? r.ontologyId : KERNEL_ONTOLOGY;
    const allowed = grants.some(
      (g) =>
        ontologyInGrant(g, ontologyId) &&
        matches(g.objectTypes, r.objectTypeId) &&
        (g.operations ?? ['read']).includes('read'),
    );
    if (!allowed) return false;
    if (!max) return true;
    const marking = (r as { classification?: string }).classification;
    if (!marking) return true;
    return canViewAtLevel(marking, max);
  });
}
