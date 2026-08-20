/**
 * ProjectionWriter PostgreSQL: rollback, replay, concurrency, restart.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createSystemClock, createUuidIdGenerator, tryOpenIsolatedPg } from 'object-platform';
import { createAllowAllTestPolicy } from 'policy-engine';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('ProjectionWriter PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('rollback after injected write, replay, concurrent claim, restart', async () => {
    if (!db) return;
    const ctx = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      policy: createAllowAllTestPolicy(),
    });
    const o = await ctx.ontology.createOntology({ name: 'proj' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'status',
      displayName: 'Status',
      baseType: 'string',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: ['status'],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });

    const { createProjectionWriter, createPgProjectionLedger } =
      await import('object-platform');
    const { createPgOperationalEventStore } = await import('action-engine');
    const { createPgOutboxRepository } = await import('event-bus');
    const { ResourceIds } = await import('policy-engine');
    const { createPgObjectRepository, createPgLinkRepository } = await import('object-platform');
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();

    const failing = createProjectionWriter({
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
            const exploding = {
              create: async (input: Parameters<typeof oRepo.create>[0]) => {
                await oRepo.create(input);
                throw new Error('injected after create');
              },
              get: oRepo.get.bind(oRepo),
              getById: oRepo.getById.bind(oRepo),
              list: oRepo.list.bind(oRepo),
              listAll: oRepo.listAll.bind(oRepo),
              update: oRepo.update.bind(oRepo),
              delete: oRepo.delete.bind(oRepo),
            };
            return fn({
              objects: exploding,
              links: createPgLinkRepository({ sql: tx }),
              events: createPgOperationalEventStore({ sql: tx, clock, nextId }),
              ledger: createPgProjectionLedger({ sql: tx }),
              outbox: createPgOutboxRepository({ sql: tx }),
            });
          }),
      },
    });

    await expect(
      failing.projectObject({
        ontologyId: o.id,
        objectTypeId: 'ot.order',
        primaryKey: 'boom',
        properties: { status: 'x' },
        source: 'erp',
        sourceEventId: 'inj-1',
        principal: 'svc',
      }),
    ).rejects.toThrow(/injected after create/);
    expect(await ctx.objects.get(o.id, 'ot.order', 'boom')).toBeUndefined();

    const recovered = await ctx.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: 'boom',
      properties: { status: 'x' },
      source: 'erp',
      sourceEventId: 'inj-1',
      principal: 'svc',
    });
    expect(recovered.status).toBe('applied');

    const first = await ctx.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'pg-1',
      principal: 'svc',
    });
    expect(first.status).toBe('applied');
    const replay = await ctx.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'pg-1',
      principal: 'svc',
    });
    expect(replay.status).toBe('replayed');
    expect((await ctx.objects.get(o.id, 'ot.order', '1'))?.version).toBe(1);

    const cmd = {
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '2',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'pg-conc',
      principal: 'svc',
    };
    const [a, b] = await Promise.all([
      ctx.projections.projectObject(cmd),
      ctx.projections.projectObject(cmd),
    ]);
    expect(new Set([a.status, b.status])).toEqual(new Set(['applied', 'replayed']));

    await ctx.close?.();
    const sql2 = db.reconnect();
    const ctx2 = await createPostgresPlatformContext({
      sql: sql2,
      transaction: sql2,
      policy: createAllowAllTestPolicy(),
    });
    const afterRestart = await ctx2.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'pg-1',
      principal: 'svc',
    });
    expect(afterRestart.status).toBe('replayed');
    await ctx2.close?.();
    await sql2.close();
  });
});
