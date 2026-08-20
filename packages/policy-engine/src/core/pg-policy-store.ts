/**
 * policy-engine — src/core/pg-policy-store.ts
 * PostgreSQL PolicyStore with in-memory snapshot cache keyed by policy_generation.
 */

import type {
  Epid,
  PolicyNode,
  PolicyNodeId,
  PrincipalId,
  SqlClient,
  TransactionManager,
} from 'contracts';

import { parsePolicyCatalog } from './policy-catalog.js';
import { parsePolicyOverlay, type PolicyOverlay } from './policy-overlay.js';
import {
  PolicyGenerationConflict,
  type PolicyEpidTuple,
  type PolicySnapshot,
  type PolicySnapshotWrite,
  type PolicyStore,
} from './policy-store.js';

const ROOT = 'ROOT';

export interface CreatePgPolicyStoreOptions {
  sql: SqlClient;
  /** Required for replaceSnapshot; duck-typed from sql when omitted. */
  transaction?: TransactionManager;
}

type SqlWithListen = SqlClient & {
  listen?: (
    channel: string,
    onNotify: (payload: string) => void,
  ) => Promise<() => void | Promise<void>>;
};

const POLICY_GENERATION_CHANNEL = 'neumann_policy_generation';

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

function overlayFromRow(raw: unknown): PolicyOverlay {
  return parsePolicyOverlay(raw);
}

function resolveTransaction(
  sql: SqlClient,
  transaction?: TransactionManager,
): TransactionManager {
  if (transaction) return transaction;
  const maybe = sql as SqlClient & Partial<TransactionManager>;
  if (typeof maybe.transaction === 'function') return maybe as TransactionManager;
  throw new Error('createPgPolicyStore.replaceSnapshot requires a TransactionManager');
}

async function writeSnapshot(
  sql: SqlClient,
  next: PolicySnapshotWrite,
  expectedGeneration?: number,
): Promise<number> {
  // WHY: lock policy_meta before replacing child rows so a concurrent publisher
  // cannot insert the same keys; the loser sees a generation conflict, not
  // a unique-violation lost-update.
  const locked =
    expectedGeneration === undefined
      ? await sql.query(`SELECT generation FROM policy_meta WHERE id = true FOR UPDATE`)
      : await sql.query(
          `SELECT generation FROM policy_meta WHERE id = true AND generation = $1 FOR UPDATE`,
          [expectedGeneration],
        );
  if (expectedGeneration !== undefined && locked.rows.length === 0) {
    const cur = await sql.query(`SELECT generation FROM policy_meta WHERE id = true`);
    throw new PolicyGenerationConflict(expectedGeneration, Number(cur.rows[0]?.generation ?? 0));
  }
  await sql.query(`DELETE FROM policy_epid_tuples`);
  await sql.query(`DELETE FROM policy_grants`);
  await sql.query(`UPDATE policy_nodes SET parent_id = NULL`);
  await sql.query(`DELETE FROM policy_nodes`);
  for (const t of next.epids) {
    await sql.query(
      `INSERT INTO policy_epid_tuples (policy, parent_id, epid) VALUES ($1, $2, $3)`,
      [t.policy, parentKey(t.parentId), t.epid],
    );
  }
  for (const g of next.grants) {
    await sql.query(
      `INSERT INTO policy_grants (principal_id, policy) VALUES ($1, $2)
       ON CONFLICT (principal_id, policy) DO NOTHING`,
      [g.principal, g.policy],
    );
  }
  const ordered = [...next.nodes];
  const placed = new Set<string>();
  while (ordered.length > 0) {
    const idx = ordered.findIndex((n) => !n.parentId || placed.has(n.parentId));
    if (idx < 0) throw new Error('replaceSnapshot: parent cycle or missing parent');
    const node = ordered.splice(idx, 1)[0]!;
    await sql.query(
      `INSERT INTO policy_nodes (id, resource_id, policy, parent_id, epid)
       VALUES ($1, $2, $3, $4, $5)`,
      [node.id, node.resourceId, node.policy, node.parentId, node.epid],
    );
    placed.add(node.id);
  }
  const result =
    expectedGeneration === undefined
      ? await sql.query(
          `UPDATE policy_meta
           SET overlay = $1::jsonb, catalog = $2::jsonb, generation = generation + 1
           WHERE id = true
           RETURNING generation`,
          [JSON.stringify(next.overlay), JSON.stringify(next.catalog)],
        )
      : await sql.query(
          `UPDATE policy_meta
           SET overlay = $1::jsonb, catalog = $2::jsonb, generation = generation + 1
           WHERE id = true AND generation = $3
           RETURNING generation`,
          [JSON.stringify(next.overlay), JSON.stringify(next.catalog), expectedGeneration],
        );
  const generation = Number(result.rows[0]?.generation ?? 0);
  if (expectedGeneration !== undefined && result.rows.length === 0) {
    const cur = await sql.query(`SELECT generation FROM policy_meta WHERE id = true`);
    throw new PolicyGenerationConflict(expectedGeneration, Number(cur.rows[0]?.generation ?? 0));
  }
  await sql.query(`SELECT pg_notify('neumann_policy_generation', $1)`, [String(generation)]);
  return generation;
}

export function createPgPolicyStore(opts: CreatePgPolicyStoreOptions): PolicyStore {
  const { sql } = opts;
  let cache: PolicySnapshot | undefined;
  let cacheGeneration = -1;
  const generationListeners = new Set<(generation: number) => void>();
  let stopListen: (() => void | Promise<void>) | undefined;
  let listenStarted: Promise<void> | undefined;

  async function startNotifications(): Promise<void> {
    if (listenStarted) return listenStarted;
    const listen = (sql as SqlWithListen).listen;
    if (typeof listen !== 'function') {
      listenStarted = Promise.resolve();
      return listenStarted;
    }
    listenStarted = listen(POLICY_GENERATION_CHANNEL, (payload) => {
      if (!/^\d+$/.test(payload)) return;
      const g = Number(payload);
      cache = undefined;
      cacheGeneration = -1;
      for (const listener of generationListeners) listener(g);
    }).then((stop) => {
      stopListen = stop;
    });
    return listenStarted;
  }

  async function stopNotifications(): Promise<void> {
    const stop = stopListen;
    stopListen = undefined;
    listenStarted = undefined;
    if (stop) await stop();
  }

  async function loadSnapshot(): Promise<PolicySnapshot> {
    const gen = await sql.query(
      `SELECT generation, overlay, catalog FROM policy_meta WHERE id = true`,
    );
    const generation = Number(gen.rows[0]?.generation ?? 0);
    if (cache && cacheGeneration === generation) return cache;

    const [grantRows, nodeRows, epidRows] = await Promise.all([
      sql.query(`SELECT principal_id, policy FROM policy_grants`),
      sql.query(`SELECT id, resource_id, policy, parent_id, epid FROM policy_nodes`),
      sql.query(`SELECT policy, parent_id, epid FROM policy_epid_tuples`),
    ]);

    const snapshot: PolicySnapshot = {
      generation,
      overlay: overlayFromRow(gen.rows[0]?.overlay),
      catalog: parsePolicyCatalog(gen.rows[0]?.catalog),
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
    async replaceSnapshot(next, expectedGeneration) {
      const txMgr = resolveTransaction(sql, opts.transaction);
      const generation = await txMgr.transaction((tx) =>
        writeSnapshot(tx, next, expectedGeneration),
      );
      cache = undefined;
      cacheGeneration = -1;
      for (const listener of generationListeners) listener(generation);
      return generation;
    },
    startNotifications,
    stopNotifications,
    subscribeGeneration(listener) {
      generationListeners.add(listener);
      const listen = (sql as SqlWithListen).listen;
      // WHY: production uses LISTEN (startNotifications). Fakes without
      // listen() poll the durable generation so unit tests stay offline.
      if (typeof listen !== 'function') {
        let last = -1;
        let stopped = false;
        const tick = () => {
          void (async () => {
            if (stopped) return;
            try {
              const g = await loadSnapshot().then((s) => s.generation);
              if (stopped) return;
              if (g !== last) {
                const prev = last;
                last = g;
                if (prev !== -1) listener(g);
              }
            } catch {
              /* keep last valid generation; runtime.refresh marks degraded */
            }
          })();
        };
        const timer = setInterval(tick, 100);
        tick();
        return () => {
          stopped = true;
          clearInterval(timer);
          generationListeners.delete(listener);
        };
      }
      return () => {
        generationListeners.delete(listener);
      };
    },
  };
}

export type { PolicyEpidTuple };
