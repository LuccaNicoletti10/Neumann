/**
 * action-engine — tests/pg-durability.integration.test.ts
 * Restart + concurrent idempotency + atomic rollback.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionTypeDef, AuthorizeFn, SqlClient } from 'contracts';
import {
  createPgLinkRepository,
  createPgObjectRepository,
  createSystemClock,
  createUuidIdGenerator,
  tryOpenIsolatedPg,
  type TransactionalSqlClient,
} from 'object-platform';
import { createAuditLog, createPgAuditRepository } from 'policy-engine';

import { createActionExecutor } from '../src/core/executor.js';
import { createFailureSurvivingExecutor } from '../src/core/failure-surviving-executor.js';
import { createPgActionExecutionStore } from '../src/core/pg-execution-store.js';
import { createPgOperationalEventStore } from '../src/core/pg-events.js';
import type { ActionTransactionStores as Stores } from '../src/core/types.js';

const allowAll: AuthorizeFn = (req) => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: `allow ${req.operation}`,
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
};

function storesFor(sql: SqlClient, clock: () => string, nextId: (p: string) => string): Stores {
  return {
    objects: createPgObjectRepository({ sql, clock, nextId }),
    links: createPgLinkRepository({ sql, clock, nextId }),
    events: createPgOperationalEventStore({ sql, clock, nextId }),
    executions: createPgActionExecutionStore({ sql }),
    audit: createAuditLog({
      clock,
      nextId,
      repository: createPgAuditRepository({ sql }),
    }),
  };
}

function executorFor(sql: TransactionalSqlClient, clock: () => string, nextId: (p: string) => string) {
  const root = storesFor(sql, clock, nextId);
  return createActionExecutor({
    ...root,
    authorize: allowAll,
    mode: 'production',
    unitOfWork: {
      run: (fn) => sql.transaction((tx) => fn(storesFor(tx, clock, nextId))),
    },
    clock,
    nextId,
    actionTypes: { o1: [approve] },
  });
}

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('Action PG durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('execution + events survive restart; idempotency does not re-run', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const actions = executorFor(db.sql, clock, nextId);
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const applied = await actions.apply({
      ontologyId: 'o1',
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
    });
    expect(applied.status).toBe('SUCCEEDED');

    await db.sql.close();
    const sql2 = db.reconnect();
    const actions2 = executorFor(sql2, clock, nextId);
    const loaded = await actions2.getExecution(applied.executionId);
    expect(loaded?.status).toBe('SUCCEEDED');
    const events = await createPgOperationalEventStore({
      sql: sql2,
      clock,
      nextId,
    }).list({ kind: 'ActionApplied' });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const again = await actions2.apply({
      ontologyId: 'o1',
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
    });
    expect(again.executionId).toBe(applied.executionId);
    await sql2.close();
  });

  it('concurrent same idempotencyKey yields one logical execution', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const objects = createPgObjectRepository({ sql, clock, nextId });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '2',
      properties: { status: 'pending' },
    });
    const execA = executorFor(sql, clock, nextId);
    const execB = executorFor(sql, clock, nextId);
    const req = {
      ontologyId: 'o1' as const,
      actionApiName: 'approve',
      parameters: { orderId: '2', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'same-key',
    };
    const [r1, r2] = await Promise.all([execA.apply(req), execB.apply(req)]);
    expect(r1.status).toBe('SUCCEEDED');
    expect(r2.status).toBe('SUCCEEDED');
    expect(r1.executionId).toBe(r2.executionId);
    await sql.close();
  });

  it('failed action rolls back object mutations', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const exploding: ActionTypeDef = {
      id: 'act.boom',
      apiName: 'boom',
      displayName: 'Boom',
      inputObjectTypeIds: ['ot.order'],
      parameters: {
        orderId: { baseType: 'string', required: true },
        missingId: { baseType: 'string', required: true },
      },
      rules: [
        {
          kind: 'create_object',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'orderId',
          propertiesFromParams: {},
        },
        {
          kind: 'modify_object',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'missingId',
          setPropertiesFromParams: { status: 'orderId' },
        },
      ],
    };
    const root = storesFor(sql, clock, nextId);
    const inner = createActionExecutor({
      ...root,
      authorize: allowAll,
      mode: 'production',
      unitOfWork: {
        run: (fn) => sql.transaction((tx) => fn(storesFor(tx, clock, nextId))),
      },
      clock,
      nextId,
      actionTypes: { o1: [exploding] },
    });
    const actions = createFailureSurvivingExecutor({
      inner,
      rootExecutions: root.executions,
      clock,
    });

    const result = await actions.apply({
      ontologyId: 'o1',
      actionApiName: 'boom',
      parameters: { orderId: 'boom-1', missingId: 'does-not-exist' },
      principal: 'u1',
    });
    expect(result.status).toBe('FAILED');
    expect(await root.objects.get('o1', 'ot.order', 'boom-1')).toBeUndefined();
    const failed = await actions.getExecution(result.executionId);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toBeTruthy();
    await sql.close();
  });
});
