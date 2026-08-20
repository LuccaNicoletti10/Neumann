/**
 * platform-api — tests/prompt08b-projection-pg.integration.test.ts
 *
 * PostgreSQL integration proofs for Prompt 08B — ProjectionBatch.
 * No memory adapters, no fake SQL.
 *
 * Cases covered:
 *  PG-B1: one event creates object + two links atomically
 *  PG-B2: identical replay does not duplicate rows/events
 *  PG-B3: same event + divergent payload → PROJECTION_CONFLICT, zero writes
 *  PG-B4: failure after first effect → full rollback (no partial state)
 *  PG-B5: concurrent same event from two connections → one commit, one replay
 *  PG-B6: restart preserves replay and conflict detection
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  createPgLinkRepository,
  createPgObjectRepository,
  createPgProjectionLedger,
  createProjectionWriter,
  createSystemClock,
  createUuidIdGenerator,
  tryOpenIsolatedPg,
} from 'object-platform';
import { createAllowAllTestPolicy, ResourceIds } from 'policy-engine';
import { createPgOutboxRepository } from 'event-bus';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createPgOperationalEventStore } from 'action-engine';

const db = await tryOpenIsolatedPg();

type Sql = NonNullable<Awaited<ReturnType<typeof tryOpenIsolatedPg>>>['sql'];

async function setupCtx(sql: Sql) {
  return createPostgresPlatformContext({
    sql,
    transaction: sql,
    policy: createAllowAllTestPolicy(),
  });
}

describe.skipIf(!db)('Prompt 08B — ProjectionBatch PG integration', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('PG-B1: one event creates object + two links atomically', async () => {
    if (!db) return;
    const ctx = await setupCtx(db.sql);
    const o = await ctx.ontology.createOntology({ name: 'pg-b1' });
    await ctx.ontology.addObjectType(o.id, { id: 'ot.person', displayName: 'Person', propertyTypeIds: [] });
    await ctx.ontology.addObjectType(o.id, { id: 'ot.dept', displayName: 'Dept', propertyTypeIds: [] });
    await ctx.ontology.addLinkType(o.id, { id: 'lt.member', displayName: 'Member', sourceObjectTypeId: 'ot.person', targetObjectTypeId: 'ot.dept' });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    await ctx.projections.projectObject({ ontologyId: o.id, objectTypeId: 'ot.dept', primaryKey: 'dept-1', properties: {}, source: 'erp', sourceEventId: 'seed-d1', principal: 'svc' });
    await ctx.projections.projectObject({ ontologyId: o.id, objectTypeId: 'ot.dept', primaryKey: 'dept-2', properties: {}, source: 'erp', sourceEventId: 'seed-d2', principal: 'svc' });

    const result = await ctx.projections.projectBatch({
      ontologyId: o.id,
      source: 'erp',
      sourceEventId: 'batch-event-b1',
      principal: 'svc',
      effects: [
        { kind: 'project_object', cmd: { ontologyId: o.id, objectTypeId: 'ot.person', primaryKey: 'alice', properties: {}, source: 'erp', sourceEventId: 'batch-event-b1', principal: 'svc' } },
        { kind: 'project_link', cmd: { ontologyId: o.id, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'dept-1', source: 'erp', sourceEventId: 'batch-event-b1', principal: 'svc' } },
        { kind: 'project_link', cmd: { ontologyId: o.id, linkTypeId: 'lt.member', sourceObjectTypeId: 'ot.person', sourcePrimaryKey: 'alice', targetObjectTypeId: 'ot.dept', targetPrimaryKey: 'dept-2', source: 'erp', sourceEventId: 'batch-event-b1', principal: 'svc' } },
      ],
    });
    expect(result.status).toBe('applied');
    expect(result.results).toHaveLength(3);

    const person = await ctx.objects.get(o.id, 'ot.person', 'alice');
    expect(person).toBeDefined();
    const links = await ctx.links.listFrom(o.id, 'ot.person', 'alice', 'lt.member');
    expect(links.filter((l) => !l.deleted)).toHaveLength(2);
    await ctx.close?.();
  });

  it('PG-B2: identical replay does not duplicate rows', async () => {
    if (!db) return;
    const ctx = await setupCtx(db.sql);
    const o = await ctx.ontology.createOntology({ name: 'pg-b2' });
    await ctx.ontology.addObjectType(o.id, { id: 'ot.item', displayName: 'Item', propertyTypeIds: [] });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    const cmd = {
      ontologyId: o.id,
      source: 'erp',
      sourceEventId: 'replay-b2',
      principal: 'svc',
      effects: [
        { kind: 'project_object' as const, cmd: { ontologyId: o.id, objectTypeId: 'ot.item', primaryKey: 'item-1', properties: {}, source: 'erp', sourceEventId: 'replay-b2', principal: 'svc' } },
      ],
    };

    const r1 = await ctx.projections.projectBatch(cmd);
    expect(r1.status).toBe('applied');
    const r2 = await ctx.projections.projectBatch(cmd);
    expect(r2.status).toBe('replayed');

    const all = await ctx.objects.list(o.id, 'ot.item');
    expect(all.filter((x) => x.primaryKey === 'item-1' && !x.deleted)).toHaveLength(1);
    await ctx.close?.();
  });

  it('PG-B3: same event + divergent payload → PROJECTION_CONFLICT, zero writes', async () => {
    if (!db) return;
    const ctx = await setupCtx(db.sql);
    const o = await ctx.ontology.createOntology({ name: 'pg-b3' });
    await ctx.ontology.addPropertyType(o.id, { id: 'val', displayName: 'Val', baseType: 'string' });
    await ctx.ontology.addObjectType(o.id, { id: 'ot.thing', displayName: 'Thing', propertyTypeIds: ['val'] });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    await ctx.projections.projectBatch({
      ontologyId: o.id,
      source: 'erp',
      sourceEventId: 'conflict-b3',
      principal: 'svc',
      effects: [
        { kind: 'project_object', cmd: { ontologyId: o.id, objectTypeId: 'ot.thing', primaryKey: 't1', properties: { val: 'original' }, source: 'erp', sourceEventId: 'conflict-b3', principal: 'svc' } },
      ],
    });

    await expect(
      ctx.projections.projectBatch({
        ontologyId: o.id,
        source: 'erp',
        sourceEventId: 'conflict-b3',
        principal: 'svc',
        effects: [
          { kind: 'project_object', cmd: { ontologyId: o.id, objectTypeId: 'ot.thing', primaryKey: 't1', properties: { val: 'divergent' }, source: 'erp', sourceEventId: 'conflict-b3', principal: 'svc' } },
        ],
      }),
    ).rejects.toThrow(/projection conflict/i);

    const obj = await ctx.objects.get(o.id, 'ot.thing', 't1');
    expect(obj?.properties.val).toBe('original');
    await ctx.close?.();
  });

  it('PG-B4: failure after first effect → full rollback (no partial state)', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const ctx = await setupCtx(db.sql);
    const o = await ctx.ontology.createOntology({ name: 'pg-b4' });
    await ctx.ontology.addObjectType(o.id, { id: 'ot.node', displayName: 'Node', propertyTypeIds: [] });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    let callCount = 0;
    const failingWriter = createProjectionWriter({
      objects: ctx.objects,
      links: ctx.links,
      events: ctx.events,
      ledger: createPgProjectionLedger({ sql: db.sql }),
      outbox: createPgOutboxRepository({ sql: db.sql }),
      authorize: ctx.policy.authorizeFn,
      resourceId: ResourceIds.admin('projection'),
      ontology: ctx.ontology,
      unitOfWork: {
        run: (fn) =>
          db.sql.transaction(async (tx) => {
            const oRepo = createPgObjectRepository({ sql: tx });
            const explodingOnSecond = {
              create: async (input: Parameters<typeof oRepo.create>[0]) => {
                callCount++;
                const rec = await oRepo.create(input);
                if (callCount >= 2) throw new Error('injected-second-create');
                return rec;
              },
              get: oRepo.get.bind(oRepo),
              getById: oRepo.getById.bind(oRepo),
              list: oRepo.list.bind(oRepo),
              listAll: oRepo.listAll.bind(oRepo),
              update: oRepo.update.bind(oRepo),
              delete: oRepo.delete.bind(oRepo),
            };
            return fn({
              objects: explodingOnSecond,
              links: createPgLinkRepository({ sql: tx }),
              events: createPgOperationalEventStore({ sql: tx, clock, nextId }),
              ledger: createPgProjectionLedger({ sql: tx }),
              outbox: createPgOutboxRepository({ sql: tx }),
            });
          }),
      },
    });

    await expect(
      failingWriter.projectBatch({
        ontologyId: o.id,
        source: 'erp',
        sourceEventId: 'b4-evt',
        principal: 'svc',
        effects: [
          { kind: 'project_object', cmd: { ontologyId: o.id, objectTypeId: 'ot.node', primaryKey: 'n1', properties: {}, source: 'erp', sourceEventId: 'b4-evt', principal: 'svc' } },
          { kind: 'project_object', cmd: { ontologyId: o.id, objectTypeId: 'ot.node', primaryKey: 'n2', properties: {}, source: 'erp', sourceEventId: 'b4-evt', principal: 'svc' } },
        ],
      }),
    ).rejects.toThrow(/injected-second-create/);

    expect(await ctx.objects.get(o.id, 'ot.node', 'n1')).toBeUndefined();
    expect(await ctx.objects.get(o.id, 'ot.node', 'n2')).toBeUndefined();
    await ctx.close?.();
  });

  it('PG-B5: concurrent same event → one commit, one replay', async () => {
    if (!db) return;
    const ctx = await setupCtx(db.sql);
    const o = await ctx.ontology.createOntology({ name: 'pg-b5' });
    await ctx.ontology.addObjectType(o.id, { id: 'ot.widget', displayName: 'Widget', propertyTypeIds: [] });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    const sql2 = db.reconnect();
    const ctx2 = await setupCtx(sql2);

    const cmd = {
      ontologyId: o.id,
      source: 'erp',
      sourceEventId: 'conc-b5',
      principal: 'svc',
      effects: [
        { kind: 'project_object' as const, cmd: { ontologyId: o.id, objectTypeId: 'ot.widget', primaryKey: 'w1', properties: {}, source: 'erp', sourceEventId: 'conc-b5', principal: 'svc' } },
      ],
    };
    const [r1, r2] = await Promise.all([
      ctx.projections.projectBatch(cmd),
      ctx2.projections.projectBatch(cmd),
    ]);
    const statuses = new Set([r1.status, r2.status]);
    expect(statuses).toEqual(new Set(['applied', 'replayed']));
    const all = await ctx.objects.list(o.id, 'ot.widget');
    expect(all.filter((w) => w.primaryKey === 'w1' && !w.deleted)).toHaveLength(1);
    await ctx.close?.();
    await ctx2.close?.();
    await sql2.close();
  });

  it('PG-B6: restart preserves replay and conflict detection', async () => {
    if (!db) return;
    const ctx1 = await setupCtx(db.sql);
    const o = await ctx1.ontology.createOntology({ name: 'pg-b6' });
    await ctx1.ontology.addPropertyType(o.id, { id: 'x', displayName: 'X', baseType: 'string' });
    await ctx1.ontology.addObjectType(o.id, { id: 'ot.box', displayName: 'Box', propertyTypeIds: ['x'] });
    await ctx1.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    const original = {
      ontologyId: o.id,
      source: 'erp',
      sourceEventId: 'restart-b6',
      principal: 'svc',
      effects: [
        { kind: 'project_object' as const, cmd: { ontologyId: o.id, objectTypeId: 'ot.box', primaryKey: 'box1', properties: { x: 'v1' }, source: 'erp', sourceEventId: 'restart-b6', principal: 'svc' } },
      ],
    };
    await ctx1.projections.projectBatch(original);
    await ctx1.close?.();

    const sql2 = db.reconnect();
    const ctx2 = await setupCtx(sql2);
    const r2 = await ctx2.projections.projectBatch(original);
    expect(r2.status).toBe('replayed');

    await expect(
      ctx2.projections.projectBatch({
        ...original,
        effects: [
          { kind: 'project_object', cmd: { ontologyId: o.id, objectTypeId: 'ot.box', primaryKey: 'box1', properties: { x: 'diverged' }, source: 'erp', sourceEventId: 'restart-b6', principal: 'svc' } },
        ],
      }),
    ).rejects.toThrow(/projection conflict/i);
    await ctx2.close?.();
    await sql2.close();
  });
});
