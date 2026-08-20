/**
 * policy-engine — tests/policy-store.test.ts
 * Memory + PG store methods (unit). PG uses a fake SqlClient.
 */
import { describe, expect, it, vi } from 'vitest';

import type { SqlClient } from 'contracts';

import {
  canonicalizeJson,
  createMemoryPolicyStore,
  createPgPolicyStore,
  createRandomSalt,
  EMPTY_POLICY_OVERLAY,
  emptyCatalog,
  hashCanonical,
  sha256Hex,
} from '../src/index.js';

describe('createMemoryPolicyStore methods', () => {
  it('grant/revoke/nodes/epid and generation stay consistent', async () => {
    const store = createMemoryPolicyStore();
    await store.grant('alice', 'finance');
    await store.grant('alice', 'ops');
    expect([...(await store.getGrants('alice'))].sort()).toEqual(['finance', 'ops']);
    await store.revoke('alice', 'ops');
    expect([...(await store.getGrants('alice'))]).toEqual(['finance']);

    await store.createNode({
      id: 'n1',
      resourceId: 'r1',
      policy: 'finance',
      parentId: null,
      epid: 'e1',
    });
    await expect(
      store.createNode({
        id: 'n1',
        resourceId: 'r1',
        policy: 'finance',
        parentId: null,
        epid: 'e1',
      }),
    ).rejects.toThrow(/já existe/);
    await store.updateNode({
      id: 'n1',
      resourceId: 'r1b',
      policy: 'finance',
      parentId: null,
      epid: 'e1',
    });
    expect((await store.listNodes())[0]?.resourceId).toBe('r1b');

    await store.putEpid('finance', null, 'e1');
    expect(await store.getEpid('finance', null)).toBe('e1');
    const g = await store.bumpGeneration();
    expect(g).toBe(await store.getGeneration());
  });
});

describe('createPgPolicyStore methods (fake sql)', () => {
  function fakeSql(): SqlClient {
    return {
      async query<T = Record<string, unknown>>(text: string) {
        if (text.includes('RETURNING generation') || text.includes('FROM policy_meta')) {
          return { rows: [{ generation: 4, overlay: EMPTY_POLICY_OVERLAY }] as T[] };
        }
        if (text.includes('FROM policy_grants')) {
          return { rows: [{ principal_id: 'alice', policy: 'finance' }] as T[] };
        }
        if (text.includes('FROM policy_nodes')) {
          return {
            rows: [
              {
                id: 'n1',
                resource_id: 'r1',
                policy: 'finance',
                parent_id: null,
                epid: 'e1',
              },
            ] as T[],
          };
        }
        if (text.includes('FROM policy_epid_tuples')) {
          return {
            rows: [{ policy: 'finance', parent_id: 'ROOT', epid: 'e1' }] as T[],
          };
        }
        return { rows: [] as T[] };
      },
    };
  }

  it('reads grants, nodes, epids, snapshot, and mutators', async () => {
    const sql = fakeSql();
    const store = createPgPolicyStore({
      sql,
      transaction: { transaction: (fn) => fn(sql) },
    });
    expect([...(await store.getGrants('alice'))]).toEqual(['finance']);
    expect(await store.listNodes()).toEqual([
      { id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null, epid: 'e1' },
    ]);
    expect(await store.getEpid('finance', null)).toBe('e1');
    expect(await store.getGeneration()).toBe(4);
    const snap = await store.snapshot();
    expect(snap.generation).toBe(4);

    await store.putEpid('finance', null, 'e2');
    await store.grant('bob', 'ops');
    await store.revoke('bob', 'ops');
    await store.createNode({
      id: 'n2',
      resourceId: 'r2',
      policy: 'ops',
      parentId: null,
      epid: 'e2',
    });
    await store.updateNode({
      id: 'n2',
      resourceId: 'r2',
      policy: 'ops',
      parentId: null,
      epid: 'e2',
    });
    expect(await store.bumpGeneration()).toBe(4);
    expect(
      await store.replaceSnapshot({
        grants: [{ principal: 'alice', policy: 'finance' }],
        nodes: [{ id: 'n1', resourceId: 'r1', policy: 'finance', parentId: null, epid: 'e1' }],
        epids: [{ policy: 'finance', parentId: null, epid: 'e1' }],
        overlay: EMPTY_POLICY_OVERLAY,
        catalog: emptyCatalog(),
      }),
    ).toBe(4);
  });

  it('replaceSnapshot CAS conflict does not swallow the stale generation', async () => {
    const sql: SqlClient = {
      async query<T = Record<string, unknown>>(text: string) {
        if (text.includes('AND generation =')) return { rows: [] as T[] };
        if (text.includes('SELECT generation FROM policy_meta')) {
          return { rows: [{ generation: 9 }] as T[] };
        }
        return { rows: [] as T[] };
      },
    };
    const store = createPgPolicyStore({
      sql,
      transaction: { transaction: (fn) => fn(sql) },
    });
    await expect(
      store.replaceSnapshot(
        {
          grants: [],
          nodes: [],
          epids: [],
          overlay: EMPTY_POLICY_OVERLAY,
          catalog: emptyCatalog(),
        },
        3,
      ),
    ).rejects.toMatchObject({ name: 'PolicyGenerationConflict', expected: 3, actual: 9 });
  });

  it('subscribeGeneration notifies after first observed generation and ignores poll errors', async () => {
    vi.useFakeTimers();
    try {
      let generation = 1;
      let failPoll = true;
      const sql: SqlClient = {
        async query<T = Record<string, unknown>>(text: string) {
          if (text.includes('FROM policy_meta')) {
            if (failPoll) {
              failPoll = false;
              throw new Error('replica lag');
            }
            return {
              rows: [{ generation, overlay: EMPTY_POLICY_OVERLAY, catalog: emptyCatalog() }] as T[],
            };
          }
          if (text.includes('FROM policy_grants')) return { rows: [] as T[] };
          if (text.includes('FROM policy_nodes')) return { rows: [] as T[] };
          if (text.includes('FROM policy_epid_tuples')) return { rows: [] as T[] };
          return { rows: [] as T[] };
        },
      };
      const store = createPgPolicyStore({
        sql,
        transaction: { transaction: (fn) => fn(sql) },
      });
      const seen: number[] = [];
      const subscribe = store.subscribeGeneration;
      if (!subscribe) throw new Error('createPgPolicyStore must expose subscribeGeneration');
      const unsub = subscribe((g) => seen.push(g));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);
      expect(seen).toEqual([]);
      generation = 2;
      await vi.advanceTimersByTimeAsync(100);
      unsub();
      expect(seen).toEqual([2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('startNotifications uses sql.listen and does not poll', async () => {
    vi.useFakeTimers();
    try {
      let handler: (payload: string) => void = () => undefined;
      let listenCalls = 0;
      const sql = {
        ...fakeSql(),
        async listen(channel: string, onNotify: (payload: string) => void) {
          listenCalls += 1;
          expect(channel).toBe('neumann_policy_generation');
          handler = onNotify;
          return () => {
            listenCalls -= 1;
          };
        },
      };
      const store = createPgPolicyStore({
        sql,
        transaction: { transaction: (fn) => fn(sql) },
      });
      await store.startNotifications?.();
      await store.startNotifications?.();
      expect(listenCalls).toBe(1);
      const seen: number[] = [];
      const unsub = store.subscribeGeneration?.((g) => seen.push(g));
      handler('not-a-generation');
      handler('11');
      await vi.advanceTimersByTimeAsync(500);
      expect(seen).toEqual([11]);
      unsub?.();
      await store.stopNotifications?.();
      expect(listenCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('hash and salt helpers', () => {
  it('canonicalizes nested objects and hashes parts', () => {
    expect(canonicalizeJson({ b: 1, a: { z: 2, y: [3, { q: 4 }] } })).toContain('"a"');
    expect(hashCanonical({ a: 1 })).toHaveLength(64);
    expect(sha256Hex(['x', null, undefined])).toHaveLength(64);
    expect(createRandomSalt()()).toHaveLength(32);
  });
});
