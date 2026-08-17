/**
 * policy-engine — src/core/pg-policy-store.ts
 * PostgreSQL PolicyStore with in-memory snapshot cache keyed by policy_generation.
 */

import type { Epid, PolicyNode, PolicyNodeId, PrincipalId, SqlClient } from 'contracts';

import type { PolicyEpidTuple, PolicySnapshot, PolicyStore } from './policy-store.js';

const ROOT = 'ROOT';

export interface CreatePgPolicyStoreOptions {
  sql: SqlClient;
}

function parentKey(parentId: PolicyNodeId | null): string {
  return parentId ?? ROOT;
}

function fromParentKey(key: string): PolicyNodeId | null {
  return key === ROOT ? null : key;
}

function rowToNode(row: Record<string, unknown>): PolicyNode {
  return {
    id: String(row.id),
    resourceId: String(row.resource_id),
    policy: row.policy == null ? null : String(row.policy),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    epid: row.epid == null ? null : String(row.epid),
  };
}

export function createPgPolicyStore(opts: CreatePgPolicyStoreOptions): PolicyStore {
  const { sql } = opts;
  let cache: PolicySnapshot | undefined;
  let cacheGeneration = -1;

  async function loadSnapshot(): Promise<PolicySnapshot> {
    const gen = await sql.query(`SELECT generation FROM policy_meta WHERE id = true`);
    const generation = Number(gen.rows[0]?.generation ?? 0);
    if (cache && cacheGeneration === generation) return cache;

    const [grantRows, nodeRows, epidRows] = await Promise.all([
      sql.query(`SELECT principal_id, policy FROM policy_grants`),
      sql.query(`SELECT id, resource_id, policy, parent_id, epid FROM policy_nodes`),
      sql.query(`SELECT policy, parent_id, epid FROM policy_epid_tuples`),
    ]);

    const snapshot: PolicySnapshot = {
      generation,
      grants: (grantRows.rows as Record<string, unknown>[]).map((r) => ({
        principal: String(r.principal_id),
        policy: String(r.policy),
      })),
      nodes: (nodeRows.rows as Record<string, unknown>[]).map(rowToNode),
      epids: (epidRows.rows as Record<string, unknown>[]).map((r) => ({
        policy: String(r.policy),
        parentId: fromParentKey(String(r.parent_id)),
        epid: String(r.epid),
      })),
    };
    cache = snapshot;
    cacheGeneration = generation;
    return snapshot;
  }

  async function bump(): Promise<number> {
    const result = await sql.query(
      `UPDATE policy_meta SET generation = generation + 1 WHERE id = true RETURNING generation`,
    );
    const generation = Number(result.rows[0]?.generation ?? 0);
    cache = undefined;
    cacheGeneration = -1;
    return generation;
  }

  return {
    async getGrants(principal: PrincipalId) {
      const snap = await loadSnapshot();
      return new Set(snap.grants.filter((g) => g.principal === principal).map((g) => g.policy));
    },
    async listNodes() {
      const snap = await loadSnapshot();
      return snap.nodes.map((n) => ({ ...n }));
    },
    async getEpid(policy: string, parentId: PolicyNodeId | null) {
      const snap = await loadSnapshot();
      return snap.epids.find((t) => t.policy === policy && t.parentId === parentId)?.epid;
    },
    async putEpid(policy: string, parentId: PolicyNodeId | null, epid: Epid) {
      await sql.query(
        `INSERT INTO policy_epid_tuples (policy, parent_id, epid)
         VALUES ($1, $2, $3)
         ON CONFLICT (policy, parent_id) DO UPDATE SET epid = EXCLUDED.epid`,
        [policy, parentKey(parentId), epid],
      );
      await bump();
    },
    async grant(principal: PrincipalId, policy: string) {
      await sql.query(
        `INSERT INTO policy_grants (principal_id, policy)
         VALUES ($1, $2)
         ON CONFLICT (principal_id, policy) DO NOTHING`,
        [principal, policy],
      );
      await bump();
    },
    async revoke(principal: PrincipalId, policy: string) {
      await sql.query(
        `DELETE FROM policy_grants WHERE principal_id = $1 AND policy = $2`,
        [principal, policy],
      );
      await bump();
    },
    async createNode(node: PolicyNode) {
      await sql.query(
        `INSERT INTO policy_nodes (id, resource_id, policy, parent_id, epid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           resource_id = EXCLUDED.resource_id,
           policy = EXCLUDED.policy,
           parent_id = EXCLUDED.parent_id,
           epid = EXCLUDED.epid`,
        [node.id, node.resourceId, node.policy, node.parentId, node.epid],
      );
      await bump();
    },
    async updateNode(node: PolicyNode) {
      await sql.query(
        `UPDATE policy_nodes
         SET policy = $2, parent_id = $3, epid = $4, resource_id = $5
         WHERE id = $1`,
        [node.id, node.policy, node.parentId, node.epid, node.resourceId],
      );
      await bump();
    },
    async snapshot() {
      return loadSnapshot();
    },
    async bumpGeneration() {
      return bump();
    },
    async getGeneration() {
      const snap = await loadSnapshot();
      return snap.generation;
    },
  };
}

export type { PolicyEpidTuple };
