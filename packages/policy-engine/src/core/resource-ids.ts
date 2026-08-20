/**
 * Canonical resource IDs for PolicyRuntime.authorize.
 *
 * Format: `{scheme}{ontologyId}/{localId}` for namespaced kinds, `{scheme}{localId}`
 * for kernel-global kinds (admin, action-execution, ontology).
 *
 * WHY: routes and Actions must not concatenate schemes independently;
 * a typo would silently miss compiled EPID nodes (fail-open) or collide
 * across ontologies.
 */

export const KERNEL_ONTOLOGY = '_';

export const RESOURCE_SCHEME = {
  object: 'object:',
  action: 'action:',
  actionExecution: 'action-execution:',
  link: 'link:',
  admin: 'admin:',
  ontology: 'ontology:',
  function: 'function:',
  approver: 'approver:',
} as const;

export type ResourceScheme = (typeof RESOURCE_SCHEME)[keyof typeof RESOURCE_SCHEME];

const NAMESPACED: ReadonlySet<ResourceScheme> = new Set([
  RESOURCE_SCHEME.object,
  RESOURCE_SCHEME.action,
  RESOURCE_SCHEME.link,
  RESOURCE_SCHEME.function,
  RESOURCE_SCHEME.approver,
]);

function enc(part: string): string {
  return encodeURIComponent(part);
}

function dec(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function namespaced(scheme: ResourceScheme, ontologyId: string, localId: string): string {
  return `${scheme}${enc(ontologyId)}/${enc(localId)}`;
}

/**
 * Builders for every HTTP / Action resource the kernel authorizes.
 * Callers must not concatenate schemes.
 */
export const ResourceIds = {
  /** `object:{ontology}/{objectTypeId}` */
  objectType(ontologyId: string, objectTypeId: string): string {
    return namespaced(RESOURCE_SCHEME.object, ontologyId, objectTypeId);
  },
  /** `action:{ontology}/{apiName}` */
  action(ontologyId: string, apiName: string): string {
    return namespaced(RESOURCE_SCHEME.action, ontologyId, apiName);
  },
  actionExecution(executionId: string): string {
    return `${RESOURCE_SCHEME.actionExecution}${enc(executionId)}`;
  },
  /** `link:{ontology}/{linkTypeId}` */
  linkType(ontologyId: string, linkTypeId: string): string {
    return namespaced(RESOURCE_SCHEME.link, ontologyId, linkTypeId);
  },
  /** Kernel-global admin/render/ER/catalog resource. */
  admin(operation: string): string {
    return `${RESOURCE_SCHEME.admin}${enc(operation)}`;
  },
  ontology(ontologyId: string): string {
    return `${RESOURCE_SCHEME.ontology}${enc(ontologyId)}`;
  },
  function(ontologyId: string, functionId: string): string {
    return namespaced(RESOURCE_SCHEME.function, ontologyId, functionId);
  },
  /**
   * Approval policy (not a role name compared as string).
   * `approver:{ontology}/{policyName}`
   */
  approver(ontologyId: string, policyName: string): string {
    return namespaced(RESOURCE_SCHEME.approver, ontologyId, policyName);
  },
} as const;

export interface ParsedResourceId {
  scheme: ResourceScheme;
  ontologyId: string;
  localId: string;
  /** Unqualified resource string (no `@read`/`@modify` suffix). */
  resource: string;
}

/**
 * Parse a resource ID. Unknown schemes return null (caller must deny).
 * Legacy unscoped `object:ot.order` maps to ontology `KERNEL_ONTOLOGY`.
 */
export function parseResourceId(resource: string): ParsedResourceId | null {
  const unqualified = stripOpSuffix(resource);
  // WHY: `action-execution:` shares the `action:` prefix; longest match first.
  const schemes = Object.values(RESOURCE_SCHEME).slice().sort((a, b) => b.length - a.length);
  for (const scheme of schemes) {
    if (unqualified.startsWith(scheme)) {
      const value = unqualified.slice(scheme.length);
      if (NAMESPACED.has(scheme)) {
        const slash = value.indexOf('/');
        if (slash < 0) {
          return {
            scheme,
            ontologyId: KERNEL_ONTOLOGY,
            localId: dec(value),
            resource: `${scheme}${value}`,
          };
        }
        return {
          scheme,
          ontologyId: dec(value.slice(0, slash)),
          localId: dec(value.slice(slash + 1)),
          resource: unqualified,
        };
      }
      return {
        scheme,
        ontologyId: KERNEL_ONTOLOGY,
        localId: dec(value),
        resource: unqualified,
      };
    }
  }
  return null;
}

const OP_SUFFIX = /@(read|modify)$/;

function stripOpSuffix(resource: string): string {
  return resource.replace(OP_SUFFIX, '');
}

function canonicalResource(parsed: ParsedResourceId): string {
  switch (parsed.scheme) {
    case RESOURCE_SCHEME.object:
      return ResourceIds.objectType(parsed.ontologyId, parsed.localId);
    case RESOURCE_SCHEME.action:
      return ResourceIds.action(parsed.ontologyId, parsed.localId);
    case RESOURCE_SCHEME.link:
      return ResourceIds.linkType(parsed.ontologyId, parsed.localId);
    case RESOURCE_SCHEME.function:
      return ResourceIds.function(parsed.ontologyId, parsed.localId);
    case RESOURCE_SCHEME.approver:
      return ResourceIds.approver(parsed.ontologyId, parsed.localId);
    case RESOURCE_SCHEME.admin:
      return ResourceIds.admin(parsed.localId);
    case RESOURCE_SCHEME.actionExecution:
      return ResourceIds.actionExecution(parsed.localId);
    case RESOURCE_SCHEME.ontology:
      return ResourceIds.ontology(parsed.localId);
    default:
      return parsed.resource;
  }
}

/**
 * Qualify an overlay-scheme resource with the coarse operation the compiler emits.
 * Native EPID resource IDs (unparseable schemes) pass through unchanged.
 *
 * WHY: legacy `object:ot.order` and namespaced `object:_/ot.order` must hit the
 * same compiled node. Uncanonical IDs would miss the graph (fail-open or silent deny).
 */
export function qualifyResource(resource: string, operation: string): string {
  const parsed = parseResourceId(resource);
  if (!parsed) return resource;
  const op = operation === 'read' || operation === 'list' || operation === 'count' ? 'read' : 'modify';
  return `${canonicalResource(parsed)}@${op}`;
}
