/**
 * platform-api — tests/pg-platform-durability.integration.test.ts
 * Production PlatformContext uses PostgreSQL for ontology, events, executions, audit.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionTypeDef, AuthorizeFn } from 'contracts';
import { tryOpenIsolatedPg } from 'object-platform';

import { createPostgresPlatformContext } from '../src/core/context.js';

const allow: AuthorizeFn = (req) => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: `allow ${req.operation}`,
});

const deny: AuthorizeFn = (req) => ({
  decision: 'deny',
  principalEpids: [],
  resourceEpid: null,
  reason: `deny ${req.operation}`,
});

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
    const ctx = createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      authorize: allow,
    });
    expect(ctx.mode).toBe('postgres');
    expect(ctx.ontology.constructor?.name).not.toBe('Function');
  });

  it('ontology, events, executions, audit, outbox survive restart', async () => {
    if (!db) return;
    const ctx = createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      authorize: allow,
    });
    const o = await ctx.ontology.createOntology({ name: 'prod' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'pt.status',
      displayName: 'Status',
      baseType: 'string',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: ['pt.status'],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    ctx.actions.registerActionType(o.id, approve);

    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });

    const applied = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'alice',
      idempotencyKey: 'idemp-1',
    });
    expect(applied.status).toBe('SUCCEEDED');
    const head = await ctx.audit.head();
    expect(head).toBeTruthy();
    expect((await ctx.audit.verify()).ok).toBe(true);

    const outbox = await db.sql.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE topic = 'action.side_effect.writeback'`,
    );
    expect(Number(outbox.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    await db.sql.close();
    const sql2 = db.reconnect();
    const ctx2 = createPostgresPlatformContext({
      sql: sql2,
      transaction: sql2,
      authorize: allow,
    });
    ctx2.actions.registerActionType(o.id, approve);

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
    });
    expect(replay.executionId).toBe(applied.executionId);
    await sql2.close();
  });

  it('production authorize deny is persisted without default allowAll', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const ctx = createPostgresPlatformContext({
      sql,
      transaction: sql,
      authorize: deny,
    });
    const o = await ctx.ontology.createOntology({ name: 'denied' });
    ctx.actions.registerActionType(o.id, approve);
    const r = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: 'x', status: 'ok' },
      principal: 'eve',
    });
    expect(r.status).toBe('DENIED');
    await sql.close();
  });
});
