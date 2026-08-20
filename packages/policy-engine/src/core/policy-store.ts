/**
 * policy-engine — src/core/policy-store.ts
 * Durable backing for grants / nodes / EPID tuples / overlay. Memory is the test default.
 */

import type { Epid, PolicyNode, PolicyNodeId, PrincipalId } from 'contracts';

import { emptyCatalog, parsePolicyCatalog, type PolicyResourceCatalog } from './policy-catalog.js';
import {
  EMPTY_POLICY_OVERLAY,
  parsePolicyOverlay,
  type PolicyOverlay,
} from './policy-overlay.js';

export interface PolicyEpidTuple {
  epid: Epid;
  policy: string;
  parentId: PolicyNodeId | null;
}

export interface PolicySnapshot {
  grants: Array<{ principal: PrincipalId; policy: string }>;
  nodes: PolicyNode[];
  epids: PolicyEpidTuple[];
  generation: number;
  overlay: PolicyOverlay;
  catalog: PolicyResourceCatalog;
}

export interface PolicySnapshotWrite {
  grants: PolicySnapshot['grants'];
  nodes: PolicyNode[];
  epids: PolicyEpidTuple[];
  overlay: PolicyOverlay;
  catalog: PolicyResourceCatalog;
}

export interface PolicyStore {
  getGrants(principal: PrincipalId): Promise<Set<string>>;
  listNodes(): Promise<PolicyNode[]>;
  getEpid(policy: string, parentId: PolicyNodeId | null): Promise<Epid | undefined>;
  putEpid(policy: string, parentId: PolicyNodeId | null, epid: Epid): Promise<void>;
  grant(principal: PrincipalId, policy: string): Promise<void>;
  revoke(principal: PrincipalId, policy: string): Promise<void>;
  createNode(node: PolicyNode): Promise<void>;
  updateNode(node: PolicyNode): Promise<void>;
  snapshot(): Promise<PolicySnapshot>;
  bumpGeneration(): Promise<number>;
  getGeneration(): Promise<number>;
  /**
   * Atomically replace durable policy and bump generation once.
   * When expectedGeneration is set, CAS fails with PolicyGenerationConflict.
   */
  replaceSnapshot(next: PolicySnapshotWrite, expectedGeneration?: number): Promise<number>;
  subscribeGeneration?(listener: (generation: number) => void): () => void;
  /**
   * Open the dedicated LISTEN session (PostgreSQL). Memory is a no-op.
   * Must be awaited before watch() so the first NOTIFY is not missed.
   */
  startNotifications?(): Promise<void>;
  /** Await UNLISTEN + release. No-op when LISTEN was never started. */
  stopNotifications?(): Promise<void>;
}

export class PolicyGenerationConflict extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(`policy generation conflict: expected ${expected}, actual ${actual}`);
    this.name = 'PolicyGenerationConflict';
    this.expected = expected;
    this.actual = actual;
  }
}

const ROOT = 'ROOT';

function parentKey(parentId: PolicyNodeId | null): string {
  return parentId ?? ROOT;
}

export function createMemoryPolicyStore(initial?: PolicySnapshot): PolicyStore {
  const grants = new Map<PrincipalId, Set<string>>();
  const nodes = new Map<PolicyNodeId, PolicyNode>();
  const epids = new Map<string, PolicyEpidTuple>();
  let generation = initial?.generation ?? 0;
  let overlay: PolicyOverlay = initial?.overlay
    ? parsePolicyOverlay(initial.overlay)
    : EMPTY_POLICY_OVERLAY;
  let catalog = initial?.catalog ? parsePolicyCatalog(initial.catalog) : emptyCatalog();
  const generationListeners = new Set<(generation: number) => void>();

  if (initial) {
    for (const g of initial.grants) {
      let set = grants.get(g.principal);
      if (!set) {
        set = new Set();
        grants.set(g.principal, set);
      }
      set.add(g.policy);
    }
    for (const n of initial.nodes) nodes.set(n.id, { ...n });
    for (const t of initial.epids) {
      epids.set(`${t.policy}::${parentKey(t.parentId)}`, { ...t });
    }
  }

  function readSnapshot(): PolicySnapshot {
    const grantRows: PolicySnapshot['grants'] = [];
    for (const [principal, set] of grants) {
      for (const policy of set) grantRows.push({ principal, policy });
    }
    return {
      grants: grantRows,
      nodes: [...nodes.values()].map((n) => ({ ...n })),
      epids: [...epids.values()].map((t) => ({ ...t })),
      generation,
      overlay: parsePolicyOverlay(overlay),
      catalog: parsePolicyCatalog(catalog),
    };
  }

  return {
    async getGrants(principal) {
      return new Set(grants.get(principal) ?? []);
    },
    async listNodes() {
      return [...nodes.values()].map((n) => ({ ...n }));
    },
    async getEpid(policy, parentId) {
      return epids.get(`${policy}::${parentKey(parentId)}`)?.epid;
    },
    async putEpid(policy, parentId, epid) {
      epids.set(`${policy}::${parentKey(parentId)}`, { epid, policy, parentId });
    },
    async grant(principal, policy) {
      let set = grants.get(principal);
      if (!set) {
        set = new Set();
        grants.set(principal, set);
      }
      set.add(policy);
    },
    async revoke(principal, policy) {
      grants.get(principal)?.delete(policy);
    },
    async createNode(node) {
      if (nodes.has(node.id)) throw new Error(`nó já existe: ${node.id}`);
      nodes.set(node.id, { ...node });
    },
    async updateNode(node) {
      nodes.set(node.id, { ...node });
    },
    async snapshot() {
      return readSnapshot();
    },
    async bumpGeneration() {
      generation += 1;
      return generation;
    },
    async getGeneration() {
      return generation;
    },
    async replaceSnapshot(next, expectedGeneration) {
      if (expectedGeneration !== undefined && expectedGeneration !== generation) {
        throw new PolicyGenerationConflict(expectedGeneration, generation);
      }
      grants.clear();
      nodes.clear();
      epids.clear();
      for (const g of next.grants) {
        let set = grants.get(g.principal);
        if (!set) {
          set = new Set();
          grants.set(g.principal, set);
        }
        set.add(g.policy);
      }
      for (const n of next.nodes) nodes.set(n.id, { ...n });
      for (const t of next.epids) {
        epids.set(`${t.policy}::${parentKey(t.parentId)}`, { ...t });
      }
      overlay = parsePolicyOverlay(next.overlay);
      catalog = parsePolicyCatalog(next.catalog);
      generation += 1;
      for (const listener of generationListeners) listener(generation);
      return generation;
    },
    subscribeGeneration(listener) {
      generationListeners.add(listener);
      return () => {
        generationListeners.delete(listener);
      };
    },
  };
}
