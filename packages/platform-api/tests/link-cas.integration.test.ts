/**
 * platform-api — tests/link-cas.integration.test.ts
 *
 * PostgreSQL integration proofs for Link CAS (Prompt 08B, item 4).
 *
 * Cases:
 *  L1: delete with correct expectedVersion → succeeds
 *  L2: delete with stale expectedVersion → VERSION_CONFLICT, row unchanged
 *  L3: two concurrent connections read same version; only one wins CAS delete
 *  L4: memory adapter mirrors the same CAS semantics (unit oracle)
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  createMemoryLinkRepository,
  createPgLinkRepository,
  createPgObjectRepository,
  createSystemClock,
  createUuidIdGenerator,
  tryOpenIsolatedPg,
} from 'object-platform';
import { createAllowAllTestPolicy } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';

const db = await tryOpenIsolatedPg();

type Sql = NonNullable<Awaited<ReturnType<typeof tryOpenIsolatedPg>>>['sql'];

async function setupOntology(sql: Sql, suffix: string) {
  const ctx = await createPostgresPlatformContext({
    sql,
    transaction: sql,
    policy: createAllowAllTestPolicy(),
  });
  const o = await ctx.ontology.createOntology({ name: `link-cas-${suffix}` });
  await ctx.ontology.addObjectType(o.id, { id: 'ot.person', displayName: 'Person', propertyTypeIds: [] });
  await ctx.ontology.addObjectType(o.id, { id: 'ot.dept', displayName: 'Dept', propertyTypeIds: [] });
  await ctx.ontology.addLinkType(o.id, { id: 'lt.member', displayName: 'Member', sourceObjectTypeId: 'ot.person', targetObjectTypeId: 'ot.dept' });
  await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  await ctx.close?.();
  return o.id;
}

describe.skipIf(!db)('Link CAS — PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('L1: delete with correct expectedVersion → success', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l1');

    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'dept-1', properties: {} });

    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    const link = await links.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'dept-1' });
    expect(link.version).toBe(1);

    const result = await links.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'dept-1', { expectedVersion: 1 });
    expect(result).toBe(true);
  });

  it('L2: delete with stale expectedVersion → VERSION_CONFLICT, row unchanged', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l2');

    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'dept-1', properties: {} });

    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    await links.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'dept-1' });

    await expect(
      links.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'dept-1', { expectedVersion: 999 }),
    ).rejects.toThrow(/version conflict/i);

    // Link must still exist.
    const rows = await links.listFrom(ontologyId, 'ot.person', 'alice', 'lt.member');
    expect(rows.filter((l) => !l.deleted)).toHaveLength(1);
  });

  it('L3: two concurrent connections — only one wins CAS delete', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l3');

    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'dept-1', properties: {} });

    const links1 = createPgLinkRepository({ sql: db.sql, clock, nextId });
    const link = await links1.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'dept-1' });
    const version = link.version!;

    const sql2 = db.reconnect();
    const links2 = createPgLinkRepository({ sql: sql2, clock, nextId });
    try {
      const results = await Promise.allSettled([
        links1.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'dept-1', { expectedVersion: version }),
        links2.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'dept-1', { expectedVersion: version }),
      ]);
      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');
      // WHY: exactly one winner; the loser must see VERSION_CONFLICT.
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      if (failures[0]?.status === 'rejected') {
        expect((failures[0].reason as Error).message).toMatch(/version conflict/i);
      }
    } finally {
      await sql2.close();
    }
  });

  it('L6: revive deleted link with correct expectedVersion succeeds in PG', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l6');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });

    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    await links.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1' });
    // delete bumps version to 2
    await links.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'd1');

    // revive with correct expectedVersion=2
    const revived = await links.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1', expectedVersion: 2 });
    expect(revived.deleted).toBe(false);
    expect(revived.version).toBe(3);
  });

  it('L7: revive deleted link with stale expectedVersion → VERSION_CONFLICT in PG', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l7');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });

    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    await links.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1' });
    await links.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'd1');

    await expect(
      links.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1', expectedVersion: 999 }),
    ).rejects.toThrow(/version conflict/i);
  });

  it('L8: two concurrent revive attempts — only one wins CAS upsert in PG', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l8');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });

    const links1 = createPgLinkRepository({ sql: db.sql, clock, nextId });
    const created = await links1.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1' });
    await links1.delete(ontologyId, 'lt.member', 'ot.person', 'alice', 'ot.dept', 'd1');
    const deletedVersion = (created.version ?? 1) + 1;

    const sql2 = db.reconnect();
    const links2 = createPgLinkRepository({ sql: sql2, clock, nextId });
    try {
      const results = await Promise.allSettled([
        links1.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1', expectedVersion: deletedVersion }),
        links2.create({ ontologyId, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'd1', expectedVersion: deletedVersion }),
      ]);
      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      if (failures[0]?.status === 'rejected') {
        expect((failures[0].reason as Error).message).toMatch(/version conflict|already exists/i);
      }
    } finally {
      await sql2.close();
    }
  });

  it('L9: active upsert with expectedVersion updates provenance and bumps version in PG', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l9');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });

    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    const created = await links.create({
      ontologyId,
      linkTypeId: 'lt.member',
      sourceObjectTypeId: 'ot.person',
      sourcePrimaryKey: 'alice',
      targetObjectTypeId: 'ot.dept',
      targetPrimaryKey: 'd1',
      provenance: { observedAt: 't1' },
    });
    expect(created.deleted).toBe(false);
    expect(created.version).toBe(1);

    const upserted = await links.create({
      ontologyId,
      linkTypeId: 'lt.member',
      sourceObjectTypeId: 'ot.person',
      sourcePrimaryKey: 'alice',
      targetObjectTypeId: 'ot.dept',
      targetPrimaryKey: 'd1',
      expectedVersion: 1,
      provenance: { observedAt: 't2' },
    });
    expect(upserted.deleted).toBe(false);
    expect(upserted.version).toBe(2);
    expect(upserted.id).toBe(created.id);
    expect(upserted.provenance?.observedAt).toBe('t2');
  });

  it('L10: live link without expectedVersion is already-exists in PG (not upsert, not revive)', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l10');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });
    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    await links.create({
      ontologyId,
      linkTypeId: 'lt.member',
      sourceObjectTypeId: 'ot.person',
      sourcePrimaryKey: 'alice',
      targetObjectTypeId: 'ot.dept',
      targetPrimaryKey: 'd1',
    });
    await expect(
      links.create({
        ontologyId,
        linkTypeId: 'lt.member',
        sourceObjectTypeId: 'ot.person',
        sourcePrimaryKey: 'alice',
        targetObjectTypeId: 'ot.dept',
        targetPrimaryKey: 'd1',
        provenance: { observedAt: 't2' },
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('L11: live link with stale expectedVersion → VERSION_CONFLICT in PG', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l11');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });
    const links = createPgLinkRepository({ sql: db.sql, clock, nextId });
    await links.create({
      ontologyId,
      linkTypeId: 'lt.member',
      sourceObjectTypeId: 'ot.person',
      sourcePrimaryKey: 'alice',
      targetObjectTypeId: 'ot.dept',
      targetPrimaryKey: 'd1',
    });
    await expect(
      links.create({
        ontologyId,
        linkTypeId: 'lt.member',
        sourceObjectTypeId: 'ot.person',
        sourcePrimaryKey: 'alice',
        targetObjectTypeId: 'ot.dept',
        targetPrimaryKey: 'd1',
        expectedVersion: 99,
      }),
    ).rejects.toThrow(/version conflict/i);
  });

  it('L13: two concurrent active upserts — only one wins CAS in PG', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ontologyId = await setupOntology(db.sql, 'l13');
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({ ontologyId, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.dept', primaryKey: 'd1', properties: {} });

    const links1 = createPgLinkRepository({ sql: db.sql, clock, nextId });
    const created = await links1.create({
      ontologyId,
      linkTypeId: 'lt.member',
      sourceObjectTypeId: 'ot.person',
      sourcePrimaryKey: 'alice',
      targetObjectTypeId: 'ot.dept',
      targetPrimaryKey: 'd1',
    });
    const version = created.version!;

    const sql2 = db.reconnect();
    const links2 = createPgLinkRepository({ sql: sql2, clock, nextId });
    try {
      const results = await Promise.allSettled([
        links1.create({
          ontologyId,
          linkTypeId: 'lt.member',
          sourceObjectTypeId: 'ot.person',
          sourcePrimaryKey: 'alice',
          targetObjectTypeId: 'ot.dept',
          targetPrimaryKey: 'd1',
          expectedVersion: version,
          provenance: { observedAt: 'a' },
        }),
        links2.create({
          ontologyId,
          linkTypeId: 'lt.member',
          sourceObjectTypeId: 'ot.person',
          sourcePrimaryKey: 'alice',
          targetObjectTypeId: 'ot.dept',
          targetPrimaryKey: 'd1',
          expectedVersion: version,
          provenance: { observedAt: 'b' },
        }),
      ]);
      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      if (failures[0]?.status === 'rejected') {
        expect((failures[0].reason as Error).message).toMatch(/version conflict/i);
      }
    } finally {
      await sql2.close();
    }
  });
});

describe('Link CAS — memory adapter (unit oracle mirrors PG semantics)', () => {
  it('L4a: delete with correct expectedVersion succeeds', async () => {
    const links = createMemoryLinkRepository();
    await links.create({ ontologyId: 'o', linkTypeId: 'lt', sourceObjectTypeId: 'src', sourcePrimaryKey: 'sp', targetObjectTypeId: 'tgt', targetPrimaryKey: 'tp' });
    const result = await links.delete('o', 'lt', 'src', 'sp', 'tgt', 'tp', { expectedVersion: 1 });
    expect(result).toBe(true);
  });

  it('L4b: delete with stale expectedVersion throws VersionConflictError', async () => {
    const links = createMemoryLinkRepository();
    await links.create({ ontologyId: 'o', linkTypeId: 'lt', sourceObjectTypeId: 'src', sourcePrimaryKey: 'sp', targetObjectTypeId: 'tgt', targetPrimaryKey: 'tp' });
    await expect(
      links.delete('o', 'lt', 'src', 'sp', 'tgt', 'tp', { expectedVersion: 999 }),
    ).rejects.toThrow(/version conflict/i);
  });

  it('L4c: delete without expectedVersion is unconditional (non-CAS callers)', async () => {
    const links = createMemoryLinkRepository();
    await links.create({ ontologyId: 'o', linkTypeId: 'lt', sourceObjectTypeId: 'src', sourcePrimaryKey: 'sp', targetObjectTypeId: 'tgt', targetPrimaryKey: 'tp' });
    const result = await links.delete('o', 'lt', 'src', 'sp', 'tgt', 'tp');
    expect(result).toBe(true);
  });

  it('L5a (mem): revive deleted link with correct expectedVersion succeeds', async () => {
    const links = createMemoryLinkRepository();
    const inp = { ontologyId: 'o', linkTypeId: 'lt', sourceObjectTypeId: 'src', sourcePrimaryKey: 'sp', targetObjectTypeId: 'tgt', targetPrimaryKey: 'tp' };
    await links.create(inp); // version=1
    await links.delete('o', 'lt', 'src', 'sp', 'tgt', 'tp'); // version=2, deleted=true
    // revive with correct expectedVersion=2
    const revived = await links.create({ ...inp, expectedVersion: 2 });
    expect(revived.deleted).toBe(false);
    expect(revived.version).toBe(3);
  });

  it('L5b (mem): revive deleted link with stale expectedVersion throws VERSION_CONFLICT', async () => {
    const links = createMemoryLinkRepository();
    const inp = { ontologyId: 'o', linkTypeId: 'lt', sourceObjectTypeId: 'src', sourcePrimaryKey: 'sp', targetObjectTypeId: 'tgt', targetPrimaryKey: 'tp' };
    await links.create(inp); // version=1
    await links.delete('o', 'lt', 'src', 'sp', 'tgt', 'tp'); // version=2
    await expect(links.create({ ...inp, expectedVersion: 1 })).rejects.toThrow(
      /version conflict/i,
    );
  });
});

describe('Active link upsert (CAS) — not revive', () => {
  it('L9 (mem): expectedVersion on a live link updates provenance and bumps version', async () => {
    const links = createMemoryLinkRepository();
    const inp = {
      ontologyId: 'o',
      linkTypeId: 'lt',
      sourceObjectTypeId: 'src',
      sourcePrimaryKey: 'sp',
      targetObjectTypeId: 'tgt',
      targetPrimaryKey: 'tp',
    };
    const created = await links.create({ ...inp, provenance: { observedAt: 't1' } });
    expect(created.deleted).toBe(false);
    expect(created.version).toBe(1);
    const upserted = await links.create({
      ...inp,
      expectedVersion: 1,
      provenance: { observedAt: 't2' },
    });
    expect(upserted.deleted).toBe(false);
    expect(upserted.version).toBe(2);
    expect(upserted.id).toBe(created.id);
    expect(upserted.provenance?.observedAt).toBe('t2');
  });

  it('L10 (mem): live link without expectedVersion is already-exists, not an upsert', async () => {
    const links = createMemoryLinkRepository();
    const inp = {
      ontologyId: 'o',
      linkTypeId: 'lt',
      sourceObjectTypeId: 'src',
      sourcePrimaryKey: 'sp',
      targetObjectTypeId: 'tgt',
      targetPrimaryKey: 'tp',
    };
    await links.create(inp);
    await expect(links.create({ ...inp, provenance: { observedAt: 't2' } })).rejects.toThrow(
      /already exists/i,
    );
  });

  it('L11 (mem): live link with stale expectedVersion throws VERSION_CONFLICT', async () => {
    const links = createMemoryLinkRepository();
    const inp = {
      ontologyId: 'o',
      linkTypeId: 'lt',
      sourceObjectTypeId: 'src',
      sourcePrimaryKey: 'sp',
      targetObjectTypeId: 'tgt',
      targetPrimaryKey: 'tp',
    };
    await links.create(inp);
    await expect(links.create({ ...inp, expectedVersion: 99 })).rejects.toThrow(
      /version conflict/i,
    );
  });
});

