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
import type { PolicyStore } from './policy-store.js';
import type { CreatePolicyEngineOptions, DecisionRecord } from './types.js';

const ALL_OPS: PolicyOperation[] = ['read', 'create', 'modify', 'delete', 'list', 'count'];

export interface HydratablePolicyEngine extends PolicyEngine {
  hydrate(): Promise<void>;
  flush(): Promise<void>;
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createPolicyEngine(opts: CreatePolicyEngineOptions = {}): HydratablePolicyEngine {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const store: PolicyStore | undefined = opts.store;
  const allowSampleRate = opts.allowSampleRate ?? 0.1;
  const sampleSeed = opts.sampleSeed ?? 'policy-decision';
  const pending: Promise<void>[] = [];
  let persistChain: Promise<void> = Promise.resolve();

  /** principal → set de policy ids (grupos). */
  const grants = new Map<PrincipalId, Set<string>>();
  const nodes = new Map<PolicyNodeId, PolicyNode>();
  const byResource = new Map<ResourceId, PolicyNodeId>();

  /** EPID → { policy, parentId } */
  const epidTuples = new Map<Epid, { policy: string; parentId: PolicyNodeId | null }>();
  /** key(policy|parent) → epid */
  const tupleToEpid = new Map<string, Epid>();
  /** policy → EPIDs (index for epidsForPrincipal; avoids scanning all tuples). */
  const policyToEpids = new Map<string, Set<Epid>>();

  function enqueue(op: () => Promise<void>): void {
    if (!store) return;
    persistChain = persistChain.then(op).catch((err) => {
      console.error('[policy-engine] persist failed:', err);
    });
    pending.push(persistChain);
  }

  function tupleKey(policy: string, parentId: PolicyNodeId | null): string {
    return `${policy}::${parentId ?? 'ROOT'}`;
  }

  function indexEpid(policy: string, epid: Epid): void {
    let set = policyToEpids.get(policy);
    if (!set) {
      set = new Set();
      policyToEpids.set(policy, set);
    }
    set.add(epid);
  }

  function getOrCreateEpid(policy: string, parentId: PolicyNodeId | null): Epid {
    const key = tupleKey(policy, parentId);
    const existing = tupleToEpid.get(key);
    if (existing) return existing;
    const epid = nextId('epid');
    tupleToEpid.set(key, epid);
    epidTuples.set(epid, { policy, parentId });
    indexEpid(policy, epid);
    enqueue(() => store!.putEpid(policy, parentId, epid));
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
    for (const policy of policies) {
      const set = policyToEpids.get(policy);
      if (set) for (const epid of set) out.add(epid);
    }
    return [...out];
  }

  function shouldLog(decision: AuthorizeResult['decision'], req: AuthorizeRequest): boolean {
    if (decision === 'deny' || decision === 'partial') return true;
    const unit = hash32(`${sampleSeed}:${req.principal}:${req.resource}:${req.operation}`) / 0x1_0000_0000;
    return unit < allowSampleRate;
  }

  function emitDecision(req: AuthorizeRequest, result: AuthorizeResult): void {
    if (!opts.onDecision) return;
    if (!shouldLog(result.decision, req)) return;
    const record: DecisionRecord = {
      principal: req.principal,
      resource: req.resource,
      operation: req.operation,
      decision: result.decision,
      principalEpids: result.principalEpids,
      resourceEpid: result.resourceEpid,
      reason: result.reason,
      at: clock(),
    };
    opts.onDecision(record);
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
        reason: 'not found',
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
        reason: 'not found',
      };
      assertAuthorizeResult(r);
      return r;
    }

    const allowed = principalEpids.includes(resourceEpid);
    if (!allowed) {
      const r: AuthorizeResult = {
        decision: 'deny',
        principalEpids,
        resourceEpid: null,
        reason: 'not found',
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
      enqueue(() => store!.updateNode(n));
    }
  }

  const engine: HydratablePolicyEngine = {
    async hydrate() {
      if (!store) return;
      const snap = await store.snapshot();
      grants.clear();
      nodes.clear();
      byResource.clear();
      epidTuples.clear();
      tupleToEpid.clear();
      policyToEpids.clear();
      for (const g of snap.grants) {
        let set = grants.get(g.principal);
        if (!set) {
          set = new Set();
          grants.set(g.principal, set);
        }
        set.add(g.policy);
      }
      for (const t of snap.epids) {
        tupleToEpid.set(tupleKey(t.policy, t.parentId), t.epid);
        epidTuples.set(t.epid, { policy: t.policy, parentId: t.parentId });
        indexEpid(t.policy, t.epid);
      }
      for (const n of snap.nodes) {
        nodes.set(n.id, { ...n });
        byResource.set(n.resourceId, n.id);
      }
    },

    async flush() {
      await persistChain;
      pending.length = 0;
    },

    grantPolicy(principal, policyId) {
      let set = grants.get(principal);
      if (!set) {
        set = new Set();
        grants.set(principal, set);
      }
      set.add(policyId);
      enqueue(() => store!.grant(principal, policyId));
    },

    revokePolicy(principal, policyId) {
      grants.get(principal)?.delete(policyId);
      enqueue(() => store!.revoke(principal, policyId));
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
      enqueue(() => store!.createNode(node));
      return node;
    },

    updateNodePolicy(nodeId, policy) {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`nó desconhecido: ${nodeId}`);
      node.policy = policy;
      node.epid = resolveEpid(node);
      invalidateDescendantUserEpids(nodeId);
      enqueue(() => store!.updateNode(node));
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
      const result = decide(req.principal, req.resource, req.operation);
      emitDecision(req, result);
      return result;
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
        if (!parent) return { ok: false, denyReason: 'not found' };
        const parentAuth = decide(principal, parent.resourceId, 'create');
        if (parentAuth.decision === 'deny') {
          return { ok: false, denyReason: 'not found' };
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
    ): { items: T[]; count: number; matrix: SecurityMatrix[] } {
      const out: T[] = [];
      const matrices: SecurityMatrix[] = [];

      for (const item of items) {
        const auth = decide(principal, item.resourceId, 'read');
        if (auth.decision === 'allow' || auth.decision === 'partial') {
          out.push(item);
          matrices.push(engine.securityMatrix(principal, item.resourceId));
        }
      }

      return { items: out, count: out.length, matrix: matrices };
    },
  };

  return engine;
}
