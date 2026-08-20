/**
 * object-platform — tests/storage-contract.integration.test.ts
 * PostgreSQL adapter of the ADR-0007 contract suite.
 */
import { afterAll, describe, it } from 'vitest';

import type { SqlClient } from 'contracts';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createPgLinkRepository } from '../src/core/pg-link-repository.js';
import { createPgObjectRepository } from '../src/core/pg-object-repository.js';
import { createPgObjectHistoryStore } from '../src/core/object-history-store.js';
import { tryOpenIsolatedPg } from '../src/core/pg-sql.js';

import { runStorageContract } from './storage-contract.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('storage contract — postgres', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('matches the canonical object/link suite including restart', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const bind = (sql: SqlClient) => {
      const objects = createPgObjectRepository({ sql, clock, nextId });
      const history = createPgObjectHistoryStore({ sql, nextId });
      const links = createPgLinkRepository({
        sql,
        clock,
        nextId,
        objectExists: async (oid, t, pk) => Boolean(await objects.get(oid, t, pk)),
      });
      return { objects, links, history };
    };
    const stores = bind(db.sql);
    await runStorageContract({
      ...stores,
      ontologyId: 'o-pg',
      uow: (fn) =>
        db.sql.transaction(async (tx) => {
          const txStores = bind(tx);
          return fn(txStores);
        }),
      reopen: async () => bind(db.sql),
    });
  });
});
