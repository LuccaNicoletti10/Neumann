/**
 * platform-api — tests/pg-platform-durability.integration.test.ts
 * Production PlatformContext uses PostgreSQL for ontology, events, executions, audit.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionTypeDef } from 'contracts';
import { createOutboxWorker, createPgOutboxRepository, createSqlMirrorWritebackHandler } from 'event-bus';
import { createDeterministicClock, tryOpenIsolatedPg } from 'object-platform';
import { createAllowAllTestPolicy, createDenyAllAuthorizer } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { principalAls } from '../src/core/principal.js';

const allow = createAllowAllTestPolicy();
const deny = createDenyAllAuthorizer();

const approve: ActionTypeDef = {
  id: 'act.approve',
  apiName: 'approve',
  displayName: 'Approve',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'object_reference', objectTypeId: 'ot.order', required: true },
    status: { baseType: 'string', required: true },
  },
  rules: [
    {
      kind: 'modify_object',
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      setPropertiesFromParams: { status: 'status' },
    },
  ],
  sideEffects: [
    { kind: 'connector_writeback', connectorId: 'erp', operation: 'update' },
  ],
};

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('createPostgresPlatformContext durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('does not wire memory stores in postgres mode', async () => {
    if (!db) return;
    const ctx = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      authorizer: allow,
    });
    expect(ctx.mode).toBe('postgres');
    expect(ctx.ontology.constructor?.name).not.toBe('Function');
  });

  it('ontology, events, executions, audit, outbox survive restart', async () => {
    if (!db) return;
    const ctx = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      authorizer: allow,
      clock: createDeterministicClock(),
    });
    const o = await ctx.ontology.createOntology({ name: 'prod' });
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
    await ctx.ontology.addActionType(o.id, approve);
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });

    const created = await principalAls.run('alice', async () => {
      const rec = await ctx.objects.create({
        ontologyId: o.id,
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'pending' },
      });
      const appliedInner = await ctx.actions.apply({
        ontologyId: o.id,
        actionApiName: 'approve',
        parameters: { orderId: '1', status: 'ok' },
        principal: 'alice',
        idempotencyKey: 'idemp-1',
        expectedObjectVersions: { 'ot.order::1': 1 },
      });
      return { rec, applied: appliedInner };
    });
    const applied = created.applied;
    expect(applied.status).toBe('SUCCEEDED');

    const trail = await ctx.history.listByObject(created.rec.id);
    expect(trail.length).toBeGreaterThanOrEqual(2);
    expect(trail[0]?.operation).toBe('create');
    expect(trail[1]?.operation).toBe('update');
    expect(trail[1]?.properties.status).toBe('ok');
    expect(trail[1]?.principal).toBe('alice');
    const asOfCreate = await ctx.history.asOf(
      o.id,
      'ot.order',
      '1',
      trail[0]!.createdAt,
    );
    expect(asOfCreate?.properties.status).toBe('pending');
    expect(asOfCreate?.operation).toBe('create');
    const asOfNow = await ctx.history.asOf(
      o.id,
      'ot.order',
      '1',
      trail[1]!.createdAt,
    );
    expect(asOfNow?.properties.status).toBe('ok');
    expect(asOfNow?.operation).toBe('update');

    const head = await ctx.audit.head();
    expect(head).toBeTruthy();
    expect((await ctx.audit.verify()).ok).toBe(true);

    const outbox = await db.sql.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE topic = 'action.side_effect.writeback'`,
    );
    expect(Number(outbox.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    const worker = createOutboxWorker({
      dispatcher: createPgOutboxRepository({ sql: db.sql }),
      handlers: {
        'action.side_effect.writeback': createSqlMirrorWritebackHandler({
          sql: db.sql,
          table: 'erp_writeback_queue',
        }),
      },
    });
    expect(await worker.drainOnce()).toBeGreaterThanOrEqual(1);
    const queued = await db.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM erp_writeback_queue`,
    );
    expect(Number(queued.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    await db.sql.close();
    const sql2 = db.reconnect();
    const ctx2 = await createPostgresPlatformContext({
      sql: sql2,
      transaction: sql2,
      authorizer: allow,
    });

    const onto = await ctx2.ontology.getOntology(o.id);
    expect(onto?.name).toBe('prod');
    const latest = await ctx2.ontology.getLatestVersion(o.id);
    expect(latest?.objectTypes['ot.order']).toBeTruthy();

    const exec = await ctx2.actions.getExecution(applied.executionId);
    expect(exec?.status).toBe('SUCCEEDED');

    const events = await ctx2.events.list({ kind: 'ActionApplied' });
    expect(events.length).toBeGreaterThanOrEqual(1);

    expect((await ctx2.audit.verify()).ok).toBe(true);
    expect((await ctx2.audit.head())?.summaryHash).toBe(head?.summaryHash);

    const replay = await ctx2.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'alice',
      idempotencyKey: 'idemp-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(replay.executionId).toBe(applied.executionId);
    await sql2.close();
  });

  it('production authorize deny is persisted without default allowAll', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const ctx = await createPostgresPlatformContext({
      sql,
      transaction: sql,
      authorizer: deny,
    });
    const o = await ctx.ontology.createOntology({ name: 'denied' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: [],
    });
    await ctx.ontology.addActionType(o.id, approve);
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    const r = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: 'x', status: 'ok' },
      principal: 'eve',
      idempotencyKey: 'deny-eve',
      expectedObjectVersions: { 'ot.order::x': 1 },
    });
    expect(r.status).toBe('DENIED');
    await sql.close();
  });
});
