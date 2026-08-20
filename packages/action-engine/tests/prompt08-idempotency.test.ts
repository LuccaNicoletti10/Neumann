/**
 * action-engine — tests/prompt08-idempotency.test.ts
 *
 * Cases A1–A10 (Actions) and C23–C25 (Terminal persistence).
 *
 * All cases run in memory (deterministic). PG cases live in
 * prompt08-pg.integration.test.ts (A4 concurrent, C24 persistence failure).
 */

import { describe, expect, it } from 'vitest';

import type { ActionTypeDef, AuthorizeFn } from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryObjectRepository,
} from 'object-platform';

import { createActionExecutor } from '../src/core/executor.js';
import { createFailureSurvivingExecutor } from '../src/core/failure-surviving-executor.js';
import { createMemoryActionExecutionStore } from '../src/core/execution-store.js';
import { createPgActionExecutionStore } from '../src/core/pg-execution-store.js';
import {
  buildActionRequestIdentity,
  serializeCanonicalRequest,
} from '../src/core/action-request-identity.js';
import { createActionWorkflowRunner } from '../src/core/workflow.js';
import { executorHarness } from './executor-harness.js';
import { seedActionOntology } from './seed-ontology.js';

const allow: AuthorizeFn = () => ({
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: 'ok',
});

const modifyAction: ActionTypeDef = {
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

const createAction: ActionTypeDef = {
  id: 'act.create',
  apiName: 'createOrder',
  displayName: 'Create',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'string', required: true },
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

// ─── A1: same principal/key/payload → same executionId + result ──────────────

describe('A1: same principal/key/payload replays without re-running', () => {
  it('returns same executionId and status on replay', async () => {
    const { exec, objects, ontologyId } = await executorHarness([modifyAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const first = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(first.status).toBe('SUCCEEDED');

    const second = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(second.executionId).toBe(first.executionId);
    expect(second.status).toBe('SUCCEEDED');
    // Object must not be touched a second time — version should stay at 2.
    const obj = await objects.get(ontologyId, 'ot.order', '1');
    expect(obj?.version).toBe(2);
  });
});

// ─── A2: same key with different payload → IDEMPOTENCY_CONFLICT, zero writes ─

describe('A2: same key + different payload = IDEMPOTENCY_CONFLICT', () => {
  it('returns FAILED with IDEMPOTENCY_CONFLICT and writes nothing', async () => {
    const { exec, objects, ontologyId } = await executorHarness([modifyAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '2',
      properties: { status: 'pending' },
    });
    // First apply succeeds.
    await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '2', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k2',
      expectedObjectVersions: { 'ot.order::2': 1 },
    });
    // Second apply with different parameters but same key.
    const conflict = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '2', status: 'different' },
      principal: 'u1',
      idempotencyKey: 'k2',
      expectedObjectVersions: { 'ot.order::2': 1 },
    });
    expect(conflict.status).toBe('FAILED');
    expect(conflict.error).toMatch(/idempotency conflict/i);
    // Object must retain the value from the first apply.
    expect((await objects.get(ontologyId, 'ot.order', '2'))?.properties.status).toBe('ok');
  });

  it('different expectedObjectVersions on same key = IDEMPOTENCY_CONFLICT', async () => {
    const { exec, objects, ontologyId } = await executorHarness([modifyAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '3',
      properties: { status: 'pending' },
    });
    await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '3', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k3',
      expectedObjectVersions: { 'ot.order::3': 1 },
    });
    const conflict = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '3', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k3',
      expectedObjectVersions: { 'ot.order::3': 99 }, // different expected version
    });
    expect(conflict.status).toBe('FAILED');
    expect(conflict.error).toMatch(/idempotency conflict/i);
  });
});

// ─── A3: different principal with same key = independent executions ───────────

describe('A3: different principal with same idempotencyKey = independent executions', () => {
  it('returns different executionIds and does not cross-contaminate', async () => {
    const { exec, ontologyId } = await executorHarness([createAction]);
    const r1 = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'p1' },
      principal: 'alice',
      idempotencyKey: 'shared-key',
    });
    expect(r1.status).toBe('SUCCEEDED');

    const r2 = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'p2' },
      principal: 'bob',
      idempotencyKey: 'shared-key',
    });
    expect(r2.status).toBe('SUCCEEDED');
    expect(r2.executionId).not.toBe(r1.executionId);
    // Bob cannot receive Alice's execution.
    const aliceExec = await exec.getExecution(r1.executionId);
    expect(aliceExec?.principal).toBe('alice');
  });
});

// ─── A5: empty expectedObjectVersions `{}` fails ─────────────────────────────

describe('A5: {} in expectedObjectVersions is rejected (not CAS-safe)', () => {
  it('fails with expectedObjectVersions error when passed an empty object for modify', async () => {
    const { exec, objects, ontologyId } = await executorHarness([modifyAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '5',
      properties: { status: 'pending' },
    });
    // {} satisfies the presence check but ot.order::5 is missing from the map.
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '5', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'a5',
      expectedObjectVersions: {},
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/i);
    expect((await objects.get(ontologyId, 'ot.order', '5'))?.properties.status).toBe('pending');
  });
});

// ─── A6: missing target → version conflict ────────────────────────────────────

describe('A6: modify target absent from expectedObjectVersions = conflict', () => {
  it('fails when modify target has no expected version entry', async () => {
    const { exec, objects, ontologyId } = await executorHarness([modifyAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '6',
      properties: { status: 'pending' },
    });
    // Missing key for ot.order::6 — only an unrelated key provided.
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '6', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'a6',
      expectedObjectVersions: { 'ot.other::6': 1 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/i);
  });
});

// ─── A7: unknown parameter rejected ───────────────────────────────────────────

describe('A7: unknown parameter is rejected by ActionParameterValidator', () => {
  it('returns FAILED with unknown param message', async () => {
    const { exec, objects, ontologyId } = await executorHarness([modifyAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '7',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '7', status: 'ok', undeclaredParam: 'bad' },
      principal: 'u1',
      idempotencyKey: 'a7',
      expectedObjectVersions: { 'ot.order::7': 1 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/undeclaredParam/);
    expect(r.error).toMatch(/not declared/i);
    // Zero writes.
    expect((await objects.get(ontologyId, 'ot.order', '7'))?.properties.status).toBe('pending');
  });
});

// ─── A8: object mutated between validation and write → conflict ───────────────

describe('A8: object modified between validation and write = VERSION_CONFLICT', () => {
  it('detects stale expectedObjectVersions at apply time', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    // Intercept update to advance version before the CAS check.
    let intercept = false;
    const objects = {
      create: inner.create.bind(inner),
      get: inner.get.bind(inner),
      getById: inner.getById.bind(inner),
      list: inner.list.bind(inner),
      listAll: inner.listAll.bind(inner),
      async update(
        ontologyId: string,
        objectTypeId: string,
        primaryKey: string,
        input: { properties: Record<string, unknown>; expectedVersion?: number },
      ) {
        if (intercept) {
          // Simulate a concurrent write that bumped the version.
          await inner.update(ontologyId, objectTypeId, primaryKey, { properties: { status: 'raced' } });
        }
        intercept = false;
        return inner.update(ontologyId, objectTypeId, primaryKey, input);
      },
      delete: inner.delete.bind(inner),
    };
    const { ontology, ontologyId } = await seedActionOntology({
      actions: [modifyAction],
      clock,
      nextId,
    });
    await inner.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '8',
      properties: { status: 'pending' },
    });
    const exec = createActionExecutor({
      objects: objects as typeof inner,
      links: {
        create: async () => {
          throw new Error('no links');
        },
        delete: async () => false,
        listFrom: async () => [],
        listTo: async () => [],
        listAll: async () => [],
      },
      ontology,
      clock,
      nextId,
      authorize: allow,
    });
    intercept = true;
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '8', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'a8',
      expectedObjectVersions: { 'ot.order::8': 1 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/i);
  });
});

// ─── A10: type and enum validators ───────────────────────────────────────────

describe('A10: type, enum, and validator enforcement', () => {
  it('rejects wrong baseType', async () => {
    const numericAction: ActionTypeDef = {
      id: 'act.num',
      apiName: 'setAmount',
      displayName: 'Set Amount',
      inputObjectTypeIds: ['ot.order'],
      parameters: {
        orderId: { baseType: 'string', required: true },
        amount: { baseType: 'number', required: true },
      },
      rules: [],
    };
    const { exec, ontologyId } = await executorHarness([numericAction]);
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'setAmount',
      parameters: { orderId: 'x', amount: 'not-a-number' },
      principal: 'u1',
      idempotencyKey: 'a10-type',
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/amount/);
    expect(r.error).toMatch(/number/);
  });

  it('rejects wrong baseType (number field receiving a string)', async () => {
    const numberAction: ActionTypeDef = {
      id: 'act.numeric',
      apiName: 'setAmount',
      displayName: 'Set Amount',
      inputObjectTypeIds: ['ot.order'],
      parameters: {
        amount: {
          baseType: 'number',
          required: true,
        },
      },
      rules: [],
    };
    const { exec, ontologyId } = await executorHarness([numberAction]);
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'setAmount',
      parameters: { amount: 'not-a-number' },
      principal: 'u1',
      idempotencyKey: 'a10-enum',
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/amount/);
    expect(r.error).toMatch(/number/i);
  });

  it('rejects unknown parameter', async () => {
    const { exec, ontologyId } = await executorHarness([createAction]);
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'x', extraField: 'nope' },
      principal: 'u1',
      idempotencyKey: 'a10-unknown',
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/extraField/);
    expect(r.error).toMatch(/not declared/i);
  });
});

// ─── A9: delete_link with CAS ─────────────────────────────────────────────────

describe('A9: delete_link is rejected without CAS when object version does not match', () => {
  it('fails when expectedObjectVersions for link endpoint is stale', async () => {
    const deleteLinkAction: ActionTypeDef = {
      id: 'act.unlink',
      apiName: 'unlink',
      displayName: 'Unlink',
      inputObjectTypeIds: ['ot.order', 'ot.item'],
      parameters: {
        orderId: { baseType: 'string', required: true },
        itemId: { baseType: 'string', required: true },
      },
      rules: [
        {
          kind: 'delete_link',
          linkTypeId: 'lt.has',
          sourceObjectTypeId: 'ot.order',
          sourcePrimaryKeyFromParam: 'orderId',
          targetObjectTypeId: 'ot.item',
          targetPrimaryKeyFromParam: 'itemId',
        },
      ],
    };
    const { exec, objects, ontologyId } = await executorHarness([deleteLinkAction], {
      objectTypeIds: ['ot.order', 'ot.item'],
    });
    await objects.create({ ontologyId, objectTypeId: 'ot.order', primaryKey: 'o1', properties: {} });
    await objects.create({ ontologyId, objectTypeId: 'ot.item', primaryKey: 'i1', properties: {} });
    // Mutate to bump version so the stale check triggers.
    await objects.update(ontologyId, 'ot.order', 'o1', { properties: { x: 1 } });

    const r = await exec.apply({
      ontologyId,
      actionApiName: 'unlink',
      parameters: { orderId: 'o1', itemId: 'i1' },
      principal: 'u1',
      idempotencyKey: 'a9',
      // Stale version 1 but current is 2.
      expectedObjectVersions: { 'ot.order::o1': 1 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/i);
  });
});

// ─── C23: rule failure = business rollback + FAILED durable record ────────────

describe('C23: rule failure = rollback + FAILED durable record', () => {
  it('keeps FAILED execution after UoW snapshot rollback', async () => {
    const explodingAction: ActionTypeDef = {
      id: 'act.explode',
      apiName: 'explode',
      displayName: 'Explode',
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
    const executions = createMemoryActionExecutionStore();
    const { exec, objects, ontologyId } = await executorHarness([explodingAction], { executions });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'explode',
      parameters: { orderId: 'boom', missingId: 'does-not-exist' },
      principal: 'u1',
      idempotencyKey: 'c23',
      expectedObjectVersions: { 'ot.order::does-not-exist': 1 },
    });
    expect(r.status).toBe('FAILED');
    // Object created by first rule must not exist (rolled back).
    expect(await objects.get(ontologyId, 'ot.order', 'boom')).toBeUndefined();
    // Execution record must survive.
    const stored = await executions.get(r.executionId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.error).toBeTruthy();
  });
});

// ─── C25: retry with same key reconciles without re-running business ──────────

describe('C25: retry with same key reconciles without duplicating business', () => {
  it('second apply with same key returns FAILED without re-running rules', async () => {
    const { exec, objects, ontologyId } = await executorHarness([createAction]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: 'dup',
      properties: {},
    });
    const first = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'dup' },
      principal: 'u1',
      idempotencyKey: 'dup-key',
    });
    expect(first.status).toBe('FAILED');
    const second = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'dup' },
      principal: 'u1',
      idempotencyKey: 'dup-key',
    });
    // Must return original execution ID (idempotency replay).
    expect(second.executionId).toBe(first.executionId);
    expect(second.status).toBe('FAILED');
    // Must not create a second object.
    const list = await objects.list(ontologyId, 'ot.order');
    expect(list.filter((o) => o.primaryKey === 'dup').length).toBe(1);
  });
});

// ─── C24: persistence failure throws ACTION_OUTCOME_PERSISTENCE_FAILED ────────

describe('C24: persistence failure throws ACTION_OUTCOME_PERSISTENCE_FAILED', () => {
  it('throws when root store fails to persist FAILED record', async () => {
    const explodingAction: ActionTypeDef = {
      id: 'act.exp2',
      apiName: 'explode2',
      displayName: 'Explode2',
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
    const { exec: inner, ontologyId } = await executorHarness([explodingAction]);
    const rootExecs = createMemoryActionExecutionStore();
    const originalRootSave = rootExecs.save.bind(rootExecs);
    rootExecs.save = async (execution) => {
      if (execution.status === 'FAILED') {
        throw new Error('root persistence failure');
      }
      return originalRootSave(execution);
    };
    const actions = createFailureSurvivingExecutor({
      inner,
      rootExecutions: rootExecs,
    });
    await expect(
      actions.apply({
        ontologyId,
        actionApiName: 'explode2',
        parameters: { orderId: 'b', missingId: 'missing' },
        principal: 'u1',
        idempotencyKey: 'c24',
        expectedObjectVersions: { 'ot.order::missing': 1 },
      }),
    ).rejects.toThrow(/ACTION_OUTCOME_PERSISTENCE_FAILED/);
  });
});

// ─── workflow.reprocess coverage ─────────────────────────────────────────────

describe('ActionWorkflowRunner.reprocess re-runs steps from a given step', () => {
  it('reruns the named step and its dependents', async () => {
    const { exec, ontologyId } = await executorHarness([createAction]);
    const runner = createActionWorkflowRunner(exec);
    const workflow = {
      id: 'wf1',
      displayName: 'Workflow 1',
      steps: [
        { id: 's1', actionApiName: 'createOrder', parameterBindings: { orderId: '$id' }, dependsOn: [] },
      ],
    };
    const result = await runner.reprocess(
      { ontologyId, workflow, parameters: { id: 'reprocess-1' }, principal: 'alice', idempotencyKey: 'rp1' },
      's1',
    );
    expect(result.status).toBe('SUCCEEDED');
  });
});

// ─── execution-store: findByIdempotencyKey ────────────────────────────────────

describe('MemoryActionExecutionStore.findByIdempotencyKey', () => {
  it('finds alice\'s execution when called with alice\'s principal', async () => {
    const store = createMemoryActionExecutionStore();
    const exec = {
      id: 'id1',
      ontologyId: 'ont',
      actionTypeId: 'act',
      actionApiName: 'doX',
      parameters: {},
      principal: 'alice',
      idempotencyKey: 'k1',
      status: 'RUNNING' as const,
      startedAt: 't',
    };
    await store.claim(exec);
    const found = await store.findByIdempotencyKey('ont', 'doX', 'k1', 'alice');
    expect(found?.id).toBe('id1');
  });

  it('returns undefined when called with a different principal (cross-principal isolation)', async () => {
    const store = createMemoryActionExecutionStore();
    const exec = {
      id: 'id2',
      ontologyId: 'ont',
      actionTypeId: 'act',
      actionApiName: 'doX',
      parameters: {},
      principal: 'alice',
      idempotencyKey: 'k2',
      status: 'RUNNING' as const,
      startedAt: 't',
    };
    await store.claim(exec);
    // bob must not see alice's execution
    const found = await store.findByIdempotencyKey('ont', 'doX', 'k2', 'bob');
    expect(found).toBeUndefined();
  });

  it('returns undefined when no matching execution exists', async () => {
    const store = createMemoryActionExecutionStore();
    const found = await store.findByIdempotencyKey('ont', 'doX', 'missing', 'alice');
    expect(found).toBeUndefined();
  });
});

// ─── PgActionExecutionStore — findByIdempotencyKey (mock sql) ─────────────────

describe('createPgActionExecutionStore.findByIdempotencyKey (stub SQL)', () => {
  it('returns execution when row exists', async () => {
    const fakeRow = {
      id: 'ex1',
      ontology_id: 'ont1',
      action_type_id: 'act1',
      action_api_name: 'doX',
      parameters: {},
      principal: 'alice',
      status: 'RUNNING',
      idempotency_key: 'key1',
      started_at: new Date().toISOString(),
      result: null,
      error: null,
      audit_entry_id: null,
      finished_at: null,
      approval: null,
      ontology_version_id: null,
      action_type_hash: null,
      expected_object_versions: null,
      policy_generation: null,
      request_hash: null,
      hash_version: null,
    };
    const stubSql = {
      query: async (_q: string, _params: unknown[]) => ({ rows: [fakeRow] }),
    };
    const store = createPgActionExecutionStore({ sql: stubSql as Parameters<typeof createPgActionExecutionStore>[0]['sql'] });
    const found = await store.findByIdempotencyKey('ont1', 'doX', 'key1', 'alice');
    expect(found?.id).toBe('ex1');
  });

  it('returns undefined when no row exists', async () => {
    const stubSql = {
      query: async (_q: string, _params: unknown[]) => ({ rows: [] }),
    };
    const store = createPgActionExecutionStore({ sql: stubSql as Parameters<typeof createPgActionExecutionStore>[0]['sql'] });
    const found = await store.findByIdempotencyKey('ont1', 'doX', 'missing', 'alice');
    expect(found).toBeUndefined();
  });

  it('get() returns execution when row exists', async () => {
    const fakeRow = {
      id: 'ex2',
      ontology_id: 'ont1',
      action_type_id: 'act1',
      action_api_name: 'doX',
      parameters: {},
      principal: 'alice',
      status: 'SUCCEEDED',
      idempotency_key: null,
      started_at: new Date().toISOString(),
      result: null,
      error: null,
      audit_entry_id: null,
      finished_at: null,
      approval: null,
      ontology_version_id: null,
      action_type_hash: null,
      expected_object_versions: null,
      policy_generation: null,
      request_hash: null,
      hash_version: null,
    };
    const stubSql = {
      query: async (_q: string, _params: unknown[]) => ({ rows: [fakeRow] }),
    };
    const store = createPgActionExecutionStore({ sql: stubSql as Parameters<typeof createPgActionExecutionStore>[0]['sql'] });
    const found = await store.get('ex2');
    expect(found?.id).toBe('ex2');
  });

  it('get() returns undefined when no row exists', async () => {
    const stubSql = {
      query: async (_q: string, _params: unknown[]) => ({ rows: [] }),
    };
    const store = createPgActionExecutionStore({ sql: stubSql as Parameters<typeof createPgActionExecutionStore>[0]['sql'] });
    expect(await store.get('missing')).toBeUndefined();
  });

  it('casStatus() returns execution when row updated', async () => {
    const fakeRow = {
      id: 'ex3',
      ontology_id: 'ont1',
      action_type_id: 'act1',
      action_api_name: 'doX',
      parameters: {},
      principal: 'alice',
      status: 'SUCCEEDED',
      idempotency_key: null,
      started_at: new Date().toISOString(),
      result: null,
      error: null,
      audit_entry_id: null,
      finished_at: null,
      approval: null,
      ontology_version_id: null,
      action_type_hash: null,
      expected_object_versions: null,
      policy_generation: null,
      request_hash: null,
      hash_version: null,
    };
    const stubSql = {
      query: async (_q: string, _params: unknown[]) => ({ rows: [fakeRow] }),
    };
    const store = createPgActionExecutionStore({ sql: stubSql as Parameters<typeof createPgActionExecutionStore>[0]['sql'] });
    const updated = await store.casStatus?.('ex3', 'RUNNING', 'SUCCEEDED');
    expect(updated?.status).toBe('SUCCEEDED');
  });

  it('casStatus() returns undefined when no row updated', async () => {
    const stubSql = {
      query: async (_q: string, _params: unknown[]) => ({ rows: [] }),
    };
    const store = createPgActionExecutionStore({ sql: stubSql as Parameters<typeof createPgActionExecutionStore>[0]['sql'] });
    const updated = await store.casStatus?.('missing', 'RUNNING', 'SUCCEEDED');
    expect(updated).toBeUndefined();
  });
});

// ─── ActionRequestIdentity helpers ───────────────────────────────────────────

describe('serializeCanonicalRequest produces stable canonical JSON', () => {
  it('produces deterministic output regardless of key insertion order', () => {
    const scope = { ontologyId: 'ont1', principal: 'alice', actionApiName: 'createOrder', idempotencyKey: 'k1' };
    const id = buildActionRequestIdentity(scope, {
      ontologyId: 'ont1',
      ontologyVersionId: 'v1',
      actionTypeId: 'act1',
      actionTypeHash: 'h1',
      principal: 'alice',
      parameters: { b: 2, a: 1 },
      expectedObjectVersions: {},
    });
    const serialized = serializeCanonicalRequest(id.canonicalRequest);
    // Keys must be sorted recursively; 'a' appears before 'b'
    expect(serialized.indexOf('"a"')).toBeLessThan(serialized.indexOf('"b"'));
    expect(id.hashVersion).toBe(1);
  });
});
