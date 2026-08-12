/**
 * policy-engine — src/core/engine.ts
 * EPID node graph + authorize + create admissions + secured read (US 10,432,469 / 10,397,229).
 */

import type {
  AuthorizeRequest,
  AuthorizeResult,
  Epid,
  PolicyEngine,
  PolicyNode,
  PolicyNodeId,
  PolicyOperation,
  PrincipalId,
  ResourceCreateResult,
  ResourceCreateSpec,
  ResourceId,
  SecurityMatrix,
} from 'contracts';
import { assertAuthorizeResult } from 'contracts';

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import type { CreatePolicyEngineOptions } from './types.js';

const ALL_OPS: PolicyOperation[] = ['read', 'create', 'modify', 'delete', 'list', 'count'];

export function createPolicyEngine(opts: CreatePolicyEngineOptions = {}): PolicyEngine {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  void clock;

  /** principal → set de policy ids (grupos). */
  const grants = new Map<PrincipalId, Set<string>>();
  const nodes = new Map<PolicyNodeId, PolicyNode>();
  const byResource = new Map<ResourceId, PolicyNodeId>();

  /** EPID → { policy, parentId } */
  const epidTuples = new Map<Epid, { policy: string; parentId: PolicyNodeId | null }>();
  /** key(policy|parent) → epid */
  const tupleToEpid = new Map<string, Epid>();

  function tupleKey(policy: string, parentId: PolicyNodeId | null): string {
    return `${policy}::${parentId ?? 'ROOT'}`;
  }

  function getOrCreateEpid(policy: string, parentId: PolicyNodeId | null): Epid {
    const key = tupleKey(policy, parentId);
    const existing = tupleToEpid.get(key);
    if (existing) return existing;
    const epid = nextId('epid');
    tupleToEpid.set(key, epid);
    epidTuples.set(epid, { policy, parentId });
    return epid;
  }

  function getParent(nodeId: PolicyNodeId | null): PolicyNode | undefined {
    if (!nodeId) return undefined;
    return nodes.get(nodeId);
  }

  function findFirstNonNullPolicyAncestor(startParentId: PolicyNodeId | null): PolicyNode | undefined {
    let cur = getParent(startParentId);
    while (cur) {
      if (cur.policy !== null) return cur;
      cur = getParent(cur.parentId);
    }
    return undefined;
  }

  function resolveEpid(node: Omit<PolicyNode, 'epid'>): Epid | null {
    if (node.policy !== null) {
      return getOrCreateEpid(node.policy, node.parentId);
    }
    // Null policy: herda policy do primeiro ancestral não-null (US 10,432,469).
    const parentWithPolicy = findFirstNonNullPolicyAncestor(node.parentId);
    if (!parentWithPolicy || parentWithPolicy.policy === null) return null;
    const grand = findFirstNonNullPolicyAncestor(parentWithPolicy.parentId);
    const parentKeyId = grand ? grand.id : parentWithPolicy.id;
    return getOrCreateEpid(parentWithPolicy.policy, parentKeyId);
  }

  function epidsForPrincipal(principal: PrincipalId): Epid[] {
    const policies = grants.get(principal);
    if (!policies || policies.size === 0) return [];
    const out = new Set<Epid>();
    for (const epid of epidTuples.keys()) {
      const t = epidTuples.get(epid)!;
      if (policies.has(t.policy)) out.add(epid);
    }
    // Também: se policy grant ainda não gerou EPID, ok — só EPIDs existentes.
    return [...out];
  }

  function decide(
    principal: PrincipalId,
    resource: ResourceId,
    operation: PolicyOperation,
  ): AuthorizeResult {
    const principalEpids = epidsForPrincipal(principal);
    const nodeId = byResource.get(resource);
    if (!nodeId) {
      const r: AuthorizeResult = {
        decision: 'deny',
        principalEpids,
        resourceEpid: null,
        reason: 'resource not found',
      };
      assertAuthorizeResult(r);
      return r;
    }
    const node = nodes.get(nodeId)!;
    const resourceEpid = node.epid;

    if (resourceEpid === null) {
      const r: AuthorizeResult = {
        decision: 'deny',
        principalEpids,
        resourceEpid: null,
        reason: 'resource has no effective policy',
      };
      assertAuthorizeResult(r);
      return r;
    }

    const allowed = principalEpids.includes(resourceEpid);
    if (!allowed) {
      const r: AuthorizeResult = {
        decision: 'deny',
        principalEpids,
        resourceEpid,
        reason: `no EPID match for ${operation}`,
      };
      assertAuthorizeResult(r);
      return r;
    }

    // partial: create/modify/delete exigem policy explícita no nó (não só herdada via null).
    if (
      (operation === 'create' || operation === 'modify' || operation === 'delete') &&
      node.policy === null
    ) {
      const r: AuthorizeResult = {
        decision: 'partial',
        principalEpids,
        resourceEpid,
        reason: 'read allowed via inheritance; write requires explicit policy on node',
      };
      assertAuthorizeResult(r);
      return r;
    }

    const r: AuthorizeResult = {
      decision: 'allow',
      principalEpids,
      resourceEpid,
      reason: `EPID ${resourceEpid} grants ${operation}`,
    };
    assertAuthorizeResult(r);
    return r;
  }

  function invalidateDescendantUserEpids(updatedNodeId: PolicyNodeId): void {
    // Recalcula EPIDs dos descendentes após update (US 10,432,469 Fig. 3).
    const stack = [updatedNodeId];
    const descendants: PolicyNodeId[] = [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const n of nodes.values()) {
        if (n.parentId === id) {
          descendants.push(n.id);
          stack.push(n.id);
        }
      }
    }
    for (const id of descendants) {
      const n = nodes.get(id)!;
      n.epid = resolveEpid(n);
    }
  }

  const engine: PolicyEngine = {
    grantPolicy(principal, policyId) {
      let set = grants.get(principal);
      if (!set) {
        set = new Set();
        grants.set(principal, set);
      }
      set.add(policyId);
    },

    revokePolicy(principal, policyId) {
      grants.get(principal)?.delete(policyId);
    },

    addNode(input) {
      if (nodes.has(input.id)) throw new Error(`nó já existe: ${input.id}`);
      if (byResource.has(input.resourceId)) {
        throw new Error(`resource já mapeado: ${input.resourceId}`);
      }
      if (input.parentId && !nodes.has(input.parentId)) {
        throw new Error(`parent desconhecido: ${input.parentId}`);
      }
      const epid = resolveEpid(input);
      const node: PolicyNode = { ...input, epid };
      nodes.set(node.id, node);
      byResource.set(node.resourceId, node.id);
      return node;
    },

    updateNodePolicy(nodeId, policy) {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`nó desconhecido: ${nodeId}`);
      node.policy = policy;
      node.epid = resolveEpid(node);
      invalidateDescendantUserEpids(nodeId);
      return node;
    },

    getNode(nodeId) {
      return nodes.get(nodeId);
    },

    getNodeByResource(resourceId) {
      const id = byResource.get(resourceId);
      return id ? nodes.get(id) : undefined;
    },

    epidsForPrincipal,

    authorize(req: AuthorizeRequest) {
      return decide(req.principal, req.resource, req.operation);
    },

    securityMatrix(principal, resource): SecurityMatrix {
      const cells = ALL_OPS.map((operation) => {
        const res = decide(principal, resource, operation);
        const hideExistence = res.decision === 'deny';
        return {
          operation,
          decision: res.decision,
          hideExistence,
        };
      });
      return { principal, resource, cells };
    },

    createResource(principal, spec: ResourceCreateSpec): ResourceCreateResult {
      // Admissions: precisa grant na policy alvo + authorize create no parent (se houver).
      const targetPolicy = spec.policy ?? null;
      if (targetPolicy === null) {
        return { ok: false, denyReason: 'create requires explicit policy on new resource' };
      }
      const policies = grants.get(principal);
      if (!policies?.has(targetPolicy)) {
        return { ok: false, denyReason: 'principal lacks create policy' };
      }
      if (spec.parentId) {
        const parent = nodes.get(spec.parentId);
        if (!parent) return { ok: false, denyReason: 'parent not found' };
        const parentAuth = decide(principal, parent.resourceId, 'create');
        if (parentAuth.decision === 'deny') {
          return { ok: false, denyReason: 'denied create under parent' };
        }
      }

      const nodeId = nextId('node');
      const node = engine.addNode({
        id: nodeId,
        resourceId: spec.resourceId,
        policy: targetPolicy,
        parentId: spec.parentId ?? null,
      });
      return {
        ok: true,
        resourceId: spec.resourceId,
        nodeId: node.id,
        epid: node.epid,
      };
    },

    securedRead<T extends { resourceId: ResourceId }>(
      principal: PrincipalId,
      items: readonly T[],
    ): { items: T[]; count: number | null; matrix: SecurityMatrix[] } {
      const out: T[] = [];
      const matrices: SecurityMatrix[] = [];

      for (const item of items) {
        const auth = decide(principal, item.resourceId, 'read');
        matrices.push(engine.securityMatrix(principal, item.resourceId));
        if (auth.decision === 'allow' || auth.decision === 'partial') {
          out.push(item);
        }
        // deny: não inclui — não revela existência.
      }

      // Gate: sem permissão não vê objeto NEM o count do universo negado.
      const deniedAll = items.length > 0 && out.length === 0;
      const count: number | null = deniedAll ? null : out.length;

      return { items: out, count, matrix: matrices };
    },
  };

  return engine;
}
