/**
 * object-platform — tests/pg-concurrency.integration.test.ts
 * Concurrent N:1 link create + link-create vs object-delete.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { LinkIntegrityError } from '../src/core/errors.js';
import { createPgLinkRepository } from '../src/core/pg-link-repository.js';
import { createPgObjectRepository } from '../src/core/pg-object-repository.js';
import { tryOpenIsolatedPg } from '../src/core/pg-sql.js';

const db = await tryOpenIsolatedPg();

function nextId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

describe.skipIf(!db)('PG link concurrency', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('concurrent N:1 creates from the same source admit exactly one live link', async () => {
    if (!db) return;
    const objects = createPgObjectRepository({ sql: db.sql, nextId });
    const links = createPgLinkRepository({
      sql: db.sql,
      nextId,
      cardinalityOf: async () => 'N:1',
    });

    await objects.create({
      ontologyId: 'o-card',
      objectTypeId: 'ot.emp',
      primaryKey: 'E1',
      properties: {},
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        objects.create({
          ontologyId: 'o-card',
          objectTypeId: 'ot.mgr',
          primaryKey: `M${i}`,
          properties: {},
        }),
      ),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        links.create({
          ontologyId: 'o-card',
          linkTypeId: 'lt.manager',
          sourceObjectTypeId: 'ot.emp',
          sourcePrimaryKey: 'E1',
          targetObjectTypeId: 'ot.mgr',
          targetPrimaryKey: `M${i}`,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const denied = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof LinkIntegrityError,
    );
    expect(ok).toHaveLength(1);
    expect(denied.length).toBe(19);

    const live = await links.listFrom('o-card', 'ot.emp', 'E1', 'lt.manager');
    expect(live).toHaveLength(1);
  });

  it('link create vs object delete never leaves a live dangling graph edge', async () => {
    if (!db) return;
    const objects = createPgObjectRepository({ sql: db.sql, nextId });
    const links = createPgLinkRepository({
      sql: db.sql,
      nextId,
      cardinalityOf: async () => 'N:N',
    });

    await objects.create({
      ontologyId: 'o-del',
      objectTypeId: 'ot.order',
      primaryKey: 'O1',
      properties: {},
    });
    await objects.create({
      ontologyId: 'o-del',
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      properties: {},
    });

    const workers = Array.from({ length: 40 }, (_, i) => {
      if (i % 2 === 0) {
        return Promise.resolve(objects.delete('o-del', 'ot.order', 'O1')).catch(() => undefined);
      }
      return Promise.resolve(
        links.create({
          ontologyId: 'o-del',
          linkTypeId: 'lt.buyer',
          sourceObjectTypeId: 'ot.order',
          sourcePrimaryKey: 'O1',
          targetObjectTypeId: 'ot.customer',
          targetPrimaryKey: 'C1',
        }),
      ).catch(() => undefined);
    });
    await Promise.all(workers);

    const order = await objects.get('o-del', 'ot.order', 'O1');
    const now = await links.listFrom('o-del', 'ot.order', 'O1', 'lt.buyer');
    if (!order) {
      expect(now).toHaveLength(0);
    } else {
      expect(now.length).toBeLessThanOrEqual(1);
      for (const edge of now) {
        expect(edge.deleted).not.toBe(true);
      }
    }
  });
});
