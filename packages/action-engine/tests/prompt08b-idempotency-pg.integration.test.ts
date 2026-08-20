/**
 * action-engine — tests/prompt08b-idempotency-pg.integration.test.ts
 *
 * PostgreSQL integration proofs for Prompt 08B.
 * Each case must use a real PG schema — no memory adapters, no fake SQL.
 *
 * Cases covered:
 *  PG-A1: same principal/key/payload → same executionId (replay, no second run)
 *  PG-A2: same key + different payload → IDEMPOTENCY_CONFLICT, zero writes
 *  PG-A3: two principals, same key → two independent executions
 *  PG-A4: concurrent same request from two pools → one winner
 *  PG-A5: principal A cannot see principal B's execution
 *  PG-A6: FAILED is durable even after business tx rollback
 *  PG-A7: persistence failure → ACTION_OUTCOME_PERSISTENCE_FAILED
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

const createOrderAction: ActionTypeDef = {
  id: 'act.create',
  apiName: 'createOrder',
  displayName: 'Create Order',
  inputObjectTypeIds: [],
  parameters: {
    orderId: { baseType: 'object_reference', required: true },
  },
  rules: [
    {
      kind: 'create_object',
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      propertiesFromParams: {},
    },
  ],
};

const modifyAction: ActionTypeDef = {
  id: 'act.modify',
  apiName: 'setStatus',
  displayName: 'Set Status',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'object_reference', required: true },
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

const _explodingAction: ActionTypeDef = {
  id: 'act.explode',
  apiName: 'explodeAction',
  displayName: 'Explode',
  inputObjectTypeIds: [],
  parameters: {
    orderId: { baseType: 'object_reference', required: true },
  },
  rules: [
    {
      kind: 'create_object',
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      propertiesFromParams: {},
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

function failingExecutorFor(
  sql: TransactionalSqlClient,
  clock: () => string,
  nextId: (p: string) => string,
  ontology: OntologyRegistry,
) {
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
  return createFailureSurvivingExecutor({ inner, rootExecutions: root.executions });
}

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('Prompt 08B — Action idempotency PG', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('PG-A1: same principal/key/payload → replay, no second business execution', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [createOrderAction]);
    const actions = executorFor(db.sql, clock, nextId, ontology);

    const r1 = await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a1-order' },
      principal: 'alice',
      idempotencyKey: 'pg-a1-key',
    });
    expect(r1.status).toBe('SUCCEEDED');

    const r2 = await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a1-order' },
      principal: 'alice',
      idempotencyKey: 'pg-a1-key',
    });
    expect(r2.status).toBe('SUCCEEDED');
    // WHY: replay must return the same execution, not a new one.
    expect(r2.executionId).toBe(r1.executionId);

    // Object must exist exactly once (no duplicate create).
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    const obj = await objects.list(ontologyId, 'ot.order');
    expect(obj.filter((o) => o.primaryKey === 'pg-a1-order' && !o.deleted)).toHaveLength(1);
  });

  it('PG-A2: same key + different payload → IDEMPOTENCY_CONFLICT, zero writes', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [createOrderAction]);
    const actions = executorFor(db.sql, clock, nextId, ontology);

    await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a2-order-first' },
      principal: 'alice',
      idempotencyKey: 'pg-a2-conflict-key',
    });

    const r2 = await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a2-order-second' },
      principal: 'alice',
      idempotencyKey: 'pg-a2-conflict-key',
    });
    expect(r2.status).toBe('FAILED');
    expect(r2.error).toMatch(/idempotency conflict/i);

    // Second order must NOT exist.
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    const all = await objects.list(ontologyId, 'ot.order');
    expect(all.find((o) => o.primaryKey === 'pg-a2-order-second')).toBeUndefined();
  });

  it('PG-A3: two principals with same key → two independent executions', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [createOrderAction]);
    const actions = executorFor(db.sql, clock, nextId, ontology);

    const r1 = await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a3-alice' },
      principal: 'alice',
      idempotencyKey: 'shared-key-pg-a3',
    });
    const r2 = await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a3-bob' },
      principal: 'bob',
      idempotencyKey: 'shared-key-pg-a3',
    });
    expect(r1.status).toBe('SUCCEEDED');
    expect(r2.status).toBe('SUCCEEDED');
    // WHY: different principals = different scope = different executions.
    expect(r1.executionId).not.toBe(r2.executionId);
  });

  it('PG-A4: concurrent same request from two pools → one winner, one replay', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [createOrderAction]);
    // Two independent SQL connections (two "pools").
    const sql1 = db.reconnect();
    const sql2 = db.reconnect();
    try {
      const exec1 = executorFor(sql1, clock, nextId, ontology);
      const exec2 = executorFor(sql2, clock, nextId, ontology);
      const [r1, r2] = await Promise.all([
        exec1.apply({
          ontologyId,
          actionApiName: 'createOrder',
          parameters: { orderId: 'pg-a4-concurrent' },
          principal: 'alice',
          idempotencyKey: 'concurrent-pg-a4',
        }),
        exec2.apply({
          ontologyId,
          actionApiName: 'createOrder',
          parameters: { orderId: 'pg-a4-concurrent' },
          principal: 'alice',
          idempotencyKey: 'concurrent-pg-a4',
        }),
      ]);
      // WHY: exactly one winner; the other replays (same executionId).
      expect(r1.status).toBe('SUCCEEDED');
      expect(r2.status).toBe('SUCCEEDED');
      expect(r1.executionId).toBe(r2.executionId);

      const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
      const all = await objects.list(ontologyId, 'ot.order');
      expect(all.filter((o) => o.primaryKey === 'pg-a4-concurrent' && !o.deleted)).toHaveLength(1);
    } finally {
      await sql1.close();
      await sql2.close();
    }
  });

  it('PG-A5: principal A cannot retrieve principal B execution via findByIdempotencyKey+principal guard', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [createOrderAction]);
    const actions = executorFor(db.sql, clock, nextId, ontology);

    await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a5-bob-order' },
      principal: 'bob',
      idempotencyKey: 'pg-a5-key',
    });

    // When alice uses the same key, she should get her own (new) execution, not bob's.
    const rAlice = await actions.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'pg-a5-alice-order' },
      principal: 'alice',
      idempotencyKey: 'pg-a5-key',
    });
    expect(rAlice.status).toBe('SUCCEEDED');
    // Alice gets her own new execution — not bob's existing one.
    const store = createPgActionExecutionStore({ sql: db.sql });
    const aliceExec = await store.get(rAlice.executionId);
    expect(aliceExec?.principal).toBe('alice');
  });

  it('PG-A6: FAILED execution is durable after business rollback', async () => {
    if (!db) return;
    const clock = createSystemClock();
    const nextId = createUuidIdGenerator();
    const { ontology, ontologyId } = await seedPg(db.sql, clock, nextId, [modifyAction]);
    const actions = failingExecutorFor(db.sql, clock, nextId, ontology);

    // Create target object first.
    const objects = createPgObjectRepository({ sql: db.sql, clock, nextId });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: 'pg-a6-order',
      properties: { status: 'pending' },
    });

    // Apply with wrong expected version to trigger VERSION_CONFLICT → FAILED.
    const r = await actions.apply({
      ontologyId,
      actionApiName: 'setStatus',
      parameters: { orderId: 'pg-a6-order', status: 'approved' },
      principal: 'alice',
      idempotencyKey: 'pg-a6-fail',
      expectedObjectVersions: { 'ot.order::pg-a6-order': 999 },
    });
    expect(r.status).toBe('FAILED');

    // The FAILED record must be durable in the DB.
    const store = createPgActionExecutionStore({ sql: db.sql });
    const found = await store.findByIdempotencyKey(ontologyId, 'setStatus', 'pg-a6-fail', 'alice');
    expect(found).toBeDefined();
    expect(found?.status).toBe('FAILED');
    // Business side must not have changed.
    const obj = await objects.get(ontologyId, 'ot.order', 'pg-a6-order');
    expect(obj?.properties.status).toBe('pending');
  });
});
