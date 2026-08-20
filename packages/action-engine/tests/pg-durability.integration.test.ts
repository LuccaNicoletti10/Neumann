/**
 * action-engine — tests/pg-durability.integration.test.ts
 * Restart + concurrent idempotency + atomic rollback + pinned envelope.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionTypeDef, OntologyRegistry, SqlClient } from 'contracts';
import {
  createPgLinkRepository,
  createPgObjectRepository,
  createSystemClock,
  createUuidIdGenerator,
  tryOpenIsolatedPg,
  type TransactionalSqlClient,
} from 'object-platform';
import { createAuditLog, createPgAuditRepository } from 'policy-engine';
import { createPgOntologyRegistry } from 'ontology-registry';

import { createActionExecutor } from '../src/core/executor.js';
import { createFailureSurvivingExecutor } from '../src/core/failure-surviving-executor.js';
import { createPgActionExecutionStore } from '../src/core/pg-execution-store.js';
import { createPgOperationalEventStore } from '../src/core/pg-events.js';
import type { ActionTransactionStores as Stores } from '../src/core/types.js';
import { seedActionOntology } from './seed-ontology.js';

const allow = () => ({
  decision: 'allow' as const,
  principalEpids: [] as string[],
  resourceEpid: null,
  reason: 'ok',
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

async function seedPg(
  sql: SqlClient,
  clock: () => string,
  nextId: (p: string) => string,
  actions: ActionTypeDef[],
): Promise<{ ontology: OntologyRegistry; ontologyId: string }> {
  const ontology = createPgOntologyRegistry({ sql, clock, nextId });
  const seeded = await seedActionOntology({ ontology, actions, clock, nextId });
  return { ontology, ontologyId: seeded.ontologyId };
}

function executorFor(
  sql: TransactionalSqlClient,
  clock: () => string,
  nextId: (p: string) => string,
  ontology: OntologyRegistry,
) {
  const root = storesFor(sql, clock, nextId);
  return createActionExecutor({
    ...root,
    ontology,
    authorize: allow,
    mode: 'production',
    unitOfWork: {
      run: (fn) => sql.transaction((tx) => fn(storesFor(tx, clock, nextId))),
    },
    clock,
    nextId,
  });
}

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('Action PG durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('execution + events + envelope survive restart; idempotency does not re-run', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [approve]);
    const actions = executorFor(db.sql, clock, nextId, ontology);
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const applied = await actions.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(applied.status).toBe('SUCCEEDED');
    const before = await actions.getExecution(applied.executionId);
    expect(before?.ontologyVersionId).toBeTruthy();
    expect(before?.actionTypeHash).toBeTruthy();
    expect(before?.expectedObjectVersions?.['ot.order::1']).toBe(1);

    await db.sql.close();
    const sql2 = db.reconnect();
    const ontology2 = createPgOntologyRegistry({ sql: sql2, clock, nextId });
    const actions2 = executorFor(sql2, clock, nextId, ontology2);
    const loaded = await actions2.getExecution(applied.executionId);
    expect(loaded?.status).toBe('SUCCEEDED');
    expect(loaded?.actionTypeHash).toBe(before?.actionTypeHash);
    expect(loaded?.ontologyVersionId).toBe(before?.ontologyVersionId);
    const events = await createPgOperationalEventStore({
      sql: sql2,
      clock,
      nextId,
    }).list({ kind: 'ActionApplied' });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const again = await actions2.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(again.executionId).toBe(applied.executionId);
    await sql2.close();
  });

  it('concurrent same idempotencyKey yields one logical execution', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(sql, clock, nextId, [approve]);
    const objects = createPgObjectRepository({ sql, clock, nextId });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '2',
      properties: { status: 'pending' },
    });
    const execA = executorFor(sql, clock, nextId, ontology);
    const execB = executorFor(sql, clock, nextId, ontology);
    const req = {
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '2', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'same-key',
      expectedObjectVersions: { 'ot.order::2': 1 },
    };
    const [r1, r2] = await Promise.all([execA.apply(req), execB.apply(req)]);
    expect(r1.status).toBe('SUCCEEDED');
    expect(r2.status).toBe('SUCCEEDED');
    expect(r1.executionId).toBe(r2.executionId);
    await sql.close();
  });

  it('failed action rolls back object mutations; FAILED record survives', async () => {
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
    const { ontology, ontologyId } = await seedPg(sql, clock, nextId, [exploding]);
    const root = storesFor(sql, clock, nextId);
    const inner = createActionExecutor({
      ...root,
      ontology,
      authorize: allow,
      mode: 'production',
      unitOfWork: {
        run: (fn) => sql.transaction((tx) => fn(storesFor(tx, clock, nextId))),
      },
      clock,
      nextId,
    });
    const actions = createFailureSurvivingExecutor({
      inner,
      rootExecutions: root.executions,
      clock,
    });

    const result = await actions.apply({
      ontologyId,
      actionApiName: 'boom',
      parameters: { orderId: 'boom-1', missingId: 'does-not-exist' },
      principal: 'u1',
      idempotencyKey: 'boom-1',
      expectedObjectVersions: { 'ot.order::does-not-exist': 1 },
    });
    expect(result.status).toBe('FAILED');
    expect(await root.objects.get(ontologyId, 'ot.order', 'boom-1')).toBeUndefined();
    const failed = await actions.getExecution(result.executionId);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toBeTruthy();
    await sql.close();
  });

  it('P0-2: mid-rule failure is queryable as FAILED with the apply executionId (no wrapper)', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const exploding: ActionTypeDef = {
      id: 'act.boom2',
      apiName: 'boom2',
      displayName: 'Boom2',
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
    const { ontology, ontologyId } = await seedPg(sql, clock, nextId, [exploding]);
    const root = storesFor(sql, clock, nextId);
    const actions = createActionExecutor({
      ...root,
      ontology,
      authorize: allow,
      mode: 'production',
      unitOfWork: {
        run: (fn) => sql.transaction((tx) => fn(storesFor(tx, clock, nextId))),
      },
      clock,
      nextId,
    });

    const result = await actions.apply({
      ontologyId,
      actionApiName: 'boom2',
      parameters: { orderId: 'boom-2', missingId: 'does-not-exist' },
      principal: 'u1',
      idempotencyKey: 'boom-2',
      expectedObjectVersions: { 'ot.order::does-not-exist': 1 },
    });
    expect(result.status).toBe('FAILED');
    expect(await root.objects.get(ontologyId, 'ot.order', 'boom-2')).toBeUndefined();
    const failed = await root.executions.get(result.executionId);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toBeTruthy();
    await sql.close();
  });

  it('P0-4: omitted optional param is not a JSONB key', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const createOpt: ActionTypeDef = {
      id: 'act.create-opt',
      apiName: 'createOpt',
      displayName: 'Create optional',
      inputObjectTypeIds: ['ot.order'],
      parameters: {
        orderId: { baseType: 'string', required: true },
        note: { baseType: 'string', required: false },
      },
      rules: [
        {
          kind: 'create_object',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'orderId',
          propertiesFromParams: { note: 'note' },
        },
      ],
    };
    const { ontology, ontologyId } = await seedPg(sql, clock, nextId, [createOpt]);
    const root = storesFor(sql, clock, nextId);
    const actions = createActionExecutor({
      ...root,
      ontology,
      authorize: allow,
      mode: 'production',
      unitOfWork: {
        run: (fn) => sql.transaction((tx) => fn(storesFor(tx, clock, nextId))),
      },
      clock,
      nextId,
    });
    const result = await actions.apply({
      ontologyId,
      actionApiName: 'createOpt',
      parameters: { orderId: 'opt-1' },
      principal: 'u1',
      idempotencyKey: 'opt-1',
    });
    expect(result.status).toBe('SUCCEEDED');
    const hasKey = await sql.query(
      `SELECT properties ? 'note' AS has_note FROM platform_objects
       WHERE ontology_id = $1 AND object_type_id = $2 AND primary_key = $3 AND deleted = false`,
      [ontologyId, 'ot.order', 'opt-1'],
    );
    expect(hasKey.rows[0]?.has_note).toBe(false);
    await sql.close();
  });

  it('P1-4: AWAITING_APPROVAL envelope survives restart then approve resumes', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const gated: ActionTypeDef = {
      ...approve,
      id: 'act.discount',
      apiName: 'discount',
      requiresApproval: true,
      approvals: { required: true, approverPolicy: 'manager' },
    };
    const sql = db.reconnect();
    const { ontology, ontologyId } = await seedPg(sql, clock, nextId, [gated]);
    const make = (client: TransactionalSqlClient, onto: OntologyRegistry) => {
      const root = storesFor(client, clock, nextId);
      return createActionExecutor({
        ...root,
        ontology: onto,
        authorize: allow,
        mode: 'production',
        unitOfWork: {
          run: (fn) => client.transaction((tx) => fn(storesFor(tx, clock, nextId))),
        },
        clock,
        nextId,
      });
    };
    const objects = createPgObjectRepository({ sql, clock, nextId });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: 'disc-1',
      properties: { status: 'pending' },
    });
    const paused = await make(sql, ontology).apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'disc-1', status: 'ok' },
      principal: 'requester',
      idempotencyKey: 'disc-1',
      expectedObjectVersions: { 'ot.order::disc-1': 1 },
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');
    const pausedRow = await make(sql, ontology).getExecution(paused.executionId);
    expect(pausedRow?.actionTypeHash).toBeTruthy();
    expect(pausedRow?.expectedObjectVersions?.['ot.order::disc-1']).toBe(1);
    await sql.close();
    const sql2 = db.reconnect();
    const ontology2 = createPgOntologyRegistry({ sql: sql2, clock, nextId });
    const resumed = make(sql2, ontology2);
    const loaded = await resumed.getExecution(paused.executionId);
    expect(loaded?.status).toBe('AWAITING_APPROVAL');
    expect(loaded?.actionTypeHash).toBe(pausedRow?.actionTypeHash);
    const done = await resumed.approve!(paused.executionId, 'approver');
    expect(done.status).toBe('SUCCEEDED');
    const obj = await createPgObjectRepository({ sql: sql2, clock, nextId }).get(
      ontologyId,
      'ot.order',
      'disc-1',
    );
    expect(obj?.properties.status).toBe('ok');
    await sql2.close();
  });

  it('object changed during approval wait is conflict after restart', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const gated: ActionTypeDef = {
      ...approve,
      id: 'act.hold',
      apiName: 'hold',
      requiresApproval: true,
      approvals: { required: true, approverPolicy: 'manager' },
    };
    const sql = db.reconnect();
    const { ontology, ontologyId } = await seedPg(sql, clock, nextId, [gated]);
    const objects = createPgObjectRepository({ sql, clock, nextId });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: 'hold-1',
      properties: { status: 'pending' },
    });
    const exec = executorFor(sql, clock, nextId, ontology);
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'hold',
      parameters: { orderId: 'hold-1', status: 'ok' },
      principal: 'requester',
      idempotencyKey: 'hold-1',
      expectedObjectVersions: { 'ot.order::hold-1': 1 },
    });
    await objects.update(ontologyId, 'ot.order', 'hold-1', { properties: { status: 'moved' } });
    await sql.close();
    const sql2 = db.reconnect();
    const ontology2 = createPgOntologyRegistry({ sql: sql2, clock, nextId });
    const resumed = executorFor(sql2, clock, nextId, ontology2);
    const r = await resumed.approve!(paused.executionId, 'approver');
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/);
    const obj = await createPgObjectRepository({ sql: sql2, clock, nextId }).get(
      ontologyId,
      'ot.order',
      'hold-1',
    );
    expect(obj?.properties.status).toBe('moved');
    await sql2.close();
  });
});
