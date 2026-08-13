/**
 * object-platform — tests/pg-integrity.integration.test.ts
 * PG delete CAS + RETURNING snapshot + link endpoint/cardinality + WORLD NOW.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { LinkIntegrityError, VersionConflictError } from '../src/core/errors.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createPgLinkRepository } from '../src/core/pg-link-repository.js';
import { createPgObjectRepository } from '../src/core/pg-object-repository.js';
import { tryOpenIsolatedPg } from '../src/core/pg-sql.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('PG object/link integrity', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('delete CAS + RETURNING post-state + dangling/cardinality on links', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    const links = createPgLinkRepository({
      sql: db.sql,
      clock,
      nextId,
      cardinalityOf: async () => 'N:1',
    });

    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.emp',
      primaryKey: 'E1',
      properties: { n: 1 },
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.mgr',
      primaryKey: 'M1',
      properties: {},
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.mgr',
      primaryKey: 'M2',
      properties: {},
    });

    await objects.update('o1', 'ot.emp', 'E1', { properties: { n: 2 } });
    await expect(objects.delete('o1', 'ot.emp', 'E1', { expectedVersion: 1 })).rejects.toThrow(
      VersionConflictError,
    );
    expect(await objects.get('o1', 'ot.emp', 'E1')).toBeTruthy();

    await expect(
      links.create({
        ontologyId: 'o1',
        linkTypeId: 'lt.manager',
        sourceObjectTypeId: 'ot.emp',
        sourcePrimaryKey: 'MISSING',
        targetObjectTypeId: 'ot.mgr',
        targetPrimaryKey: 'M1',
      }),
    ).rejects.toThrow(LinkIntegrityError);

    const created = await links.create({
      ontologyId: 'o1',
      linkTypeId: 'lt.manager',
      sourceObjectTypeId: 'ot.emp',
      sourcePrimaryKey: 'E1',
      targetObjectTypeId: 'ot.mgr',
      targetPrimaryKey: 'M1',
    });
    expect(created.version).toBe(1);
    expect(created.deleted).toBe(false);
    await expect(
      links.create({
        ontologyId: 'o1',
        linkTypeId: 'lt.manager',
        sourceObjectTypeId: 'ot.emp',
        sourcePrimaryKey: 'E1',
        targetObjectTypeId: 'ot.mgr',
        targetPrimaryKey: 'M2',
      }),
    ).rejects.toThrow(LinkIntegrityError);

    const post = await objects.delete('o1', 'ot.emp', 'E1', { expectedVersion: 2 });
    expect(post?.deleted).toBe(true);
    expect(post?.version).toBe(3);
    expect(post?.properties).toEqual({ n: 2 });

    expect(await links.listFrom('o1', 'ot.emp', 'E1', 'lt.manager')).toHaveLength(0);
    const historical = await links.listFrom('o1', 'ot.emp', 'E1', 'lt.manager', {
      includeDeletedEndpoints: true,
    });
    expect(historical).toHaveLength(1);
    expect(historical[0]?.deleted).toBe(false);
  });
});
