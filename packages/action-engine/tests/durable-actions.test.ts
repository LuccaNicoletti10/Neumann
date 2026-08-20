/**
 * Durable Action execution: pinned ontology, CAS envelope, snapshot UoW.
 */
import { describe, expect, it } from 'vitest';

import type { ActionExecution, ActionTypeDef, AuthorizeFn } from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectHistoryStore,
  createMemoryObjectRepository,
  createMemoryProjectionLedger,
  createProjectionWriter,
  createSnapshotUnitOfWork,
} from 'object-platform';

import { createAuditLog } from 'policy-engine';

import {
  createOntologyActionResolver,
  resolveActionByApiName,
} from '../src/core/action-definition-resolver.js';
import { createActionExecutor } from '../src/core/executor.js';
import { createFailureSurvivingExecutor } from '../src/core/failure-surviving-executor.js';
import { createMemoryActionExecutionStore } from '../src/core/execution-store.js';
import { createMemoryOperationalEventStore } from '../src/core/events.js';
import { createMemoryOutboxRepository } from '../src/core/memory-outbox.js';
import {
  assertActionTransition,
  isTerminalStatus,
  transitionExecution,
} from '../src/core/action-lifecycle.js';
import type { ActionUnitOfWork } from '../src/core/types.js';
import { executorHarness } from './executor-harness.js';

const gatedApprove: ActionTypeDef = {
  id: 'act.approve',
  apiName: 'approve',
  displayName: 'Approve',
  inputObjectTypeIds: ['ot.order'],
  requiresApproval: true,
  approvals: { required: true, approverPolicy: 'manager' },
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

const createDef: ActionTypeDef = {
  id: 'act.create',
  apiName: 'createOrder',
  displayName: 'Create',
  inputObjectTypeIds: ['ot.order'],
  parameters: { orderId: { baseType: 'string', required: true } },
  rules: [
    {
      kind: 'create_object',
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      propertiesFromParams: {},
    },
  ],
};

describe('action lifecycle', () => {
  it('rejects illegal and terminal reverse transitions', () => {
    expect(() => assertActionTransition('SUCCEEDED', 'RUNNING')).toThrow(/illegal/);
    expect(() => assertActionTransition('AWAITING_APPROVAL', 'PENDING')).toThrow(/illegal/);
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(isTerminalStatus('AWAITING_APPROVAL')).toBe(false);
    const row = { status: 'PENDING' } as ActionExecution;
    transitionExecution(row, 'AUTHORIZED');
    expect(row.status).toBe('AUTHORIZED');
  });
});

describe('durable Action execution (memory)', () => {
  it('1. ActionType comes only from ontology (unknown without commit)', async () => {
    const { exec, ontologyId } = await executorHarness([]);
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'x',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/unknown action/);
  });

  it('resolver fails closed when the pinned version or type is missing', async () => {
    const { ontology, ontologyId } = await executorHarness([gatedApprove]);
    const resolver = createOntologyActionResolver(ontology);
    await expect(resolver.resolve(ontologyId, 'missing-ver', 'act.approve')).rejects.toThrow(
      /pinned ontology version not found/,
    );
    const latest = await ontology.getLatestVersion(ontologyId);
    await expect(resolver.resolve(ontologyId, latest!.id, 'act.missing')).rejects.toThrow(
      /not in version/,
    );
    expect(
      await resolveActionByApiName(ontology, resolver, ontologyId, 'approve', 'missing-ver'),
    ).toBeUndefined();
  });

  it('failure-surviving executor forwards validate, tree, get, approve, reject', async () => {
    const { exec, objects, ontologyId } = await executorHarness([gatedApprove]);
    const wrap = createFailureSurvivingExecutor({
      inner: exec,
      rootExecutions: createMemoryActionExecutionStore(),
    });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const valid = await wrap.validate({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(valid.valid).toBe(true);
    const tree = await wrap.parameterTree!({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(tree.actionApiName).toBe('approve');
    const paused = await wrap.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'fwd-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');
    expect((await wrap.getExecution(paused.executionId))?.status).toBe('AWAITING_APPROVAL');
    const rejected = await wrap.reject!(paused.executionId, 'manager');
    expect(rejected.status).toBe('REJECTED');
    const again = await wrap.approve!(paused.executionId, 'manager');
    expect(again.status).toBe('REJECTED');
  });

  it('2. changing latest does not change a pending execution', async () => {
    const { exec, objects, ontology, ontologyId } = await executorHarness([gatedApprove]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'pin-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');
    await ontology.openDraft(ontologyId);
    const draft = await ontology.getDraft(ontologyId);
    draft!.actionTypes['act.approve'] = {
      ...gatedApprove,
      rules: [
        {
          kind: 'modify_object',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'orderId',
          setPropertiesFromParams: { status: 'other' },
        },
      ],
    };
    await ontology.commit({ ontologyId, createdBy: 't' });
    const done = await exec.approve!(paused.executionId, 'manager');
    expect(done.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('ok');
  });

  it('3. divergent hash fails closed with zero writes', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const { ontology, ontologyId } = await executorHarness([gatedApprove], { clock, nextId });
    const objects = createMemoryObjectRepository({ clock, nextId });
    const links = createMemoryLinkRepository({ clock, nextId });
    const executions = createMemoryActionExecutionStore();
    const events = createMemoryOperationalEventStore({ clock, nextId });
    const exec = createActionExecutor({
      objects,
      links,
      ontology,
      executions,
      events,
      authorize: () => ({
        decision: 'allow',
        principalEpids: [],
        resourceEpid: null,
        reason: 'ok',
      }),
      clock,
      nextId,
    });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'hash-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    const stored = await executions.get(paused.executionId);
    expect(stored?.actionTypeHash).toBeTruthy();
    await executions.save({ ...stored!, actionTypeHash: 'deadbeef' });
    const failed = await exec.approve!(paused.executionId, 'manager');
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toMatch(/hash/);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
  });

  it('5. object changed during approval → conflict, zero writes', async () => {
    const { exec, objects, ontologyId } = await executorHarness([gatedApprove]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'stale-wait',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    await objects.update(ontologyId, 'ot.order', '1', { properties: { status: 'other' } });
    const r = await exec.approve!(paused.executionId, 'manager');
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('other');
  });

  it('6. two approvers → one execution', async () => {
    const { exec, objects, ontologyId } = await executorHarness([gatedApprove]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'two-appr',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    const [a, b] = await Promise.all([
      exec.approve!(paused.executionId, 'manager'),
      exec.approve!(paused.executionId, 'manager-2'),
    ]);
    expect([a.status, b.status].includes('SUCCEEDED')).toBe(true);
    expect(
      [a.status, b.status].every((s) => s === 'SUCCEEDED' || s === 'RUNNING'),
    ).toBe(true);
    expect(a.executionId).toBe(b.executionId);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('ok');
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.version).toBe(2);
  });

  it('7. duplicate idempotency → same result', async () => {
    const { exec, ontologyId } = await executorHarness([createDef]);
    const a = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'n1' },
      principal: 'u1',
      idempotencyKey: 'dup-key',
    });
    const b = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'n1' },
      principal: 'u1',
      idempotencyKey: 'dup-key',
    });
    expect(a.status).toBe('SUCCEEDED');
    expect(b.executionId).toBe(a.executionId);
    expect(b.status).toBe('SUCCEEDED');
  });

  it('8. policy revoked during wait → deny, zero writes', async () => {
    let allowPrincipal = true;
    const authorize: AuthorizeFn = (req) => {
      if (req.principal === 'u1' && !allowPrincipal) {
        return {
          decision: 'deny',
          principalEpids: [],
          resourceEpid: null,
          reason: 'revoked',
        };
      }
      return { decision: 'allow', principalEpids: [], resourceEpid: null, reason: 'ok' };
    };
    const { exec, objects, ontologyId } = await executorHarness([gatedApprove], { authorize });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'revoked',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    allowPrincipal = false;
    const r = await exec.approve!(paused.executionId, 'manager');
    expect(r.status).toBe('DENIED');
    expect(r.error).toMatch(/revoked/);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
  });

  it('9. precondition changed → fail without effect', async () => {
    const gatedCreate: ActionTypeDef = {
      id: 'act.create-gated',
      apiName: 'createGated',
      displayName: 'Create gated',
      inputObjectTypeIds: ['ot.order', 'ot.gate'],
      requiresApproval: true,
      approvals: { required: true, approverPolicy: 'manager' },
      submissionCriteria: [
        {
          kind: 'property_equals',
          objectTypeId: 'ot.gate',
          primaryKeyParam: 'gateId',
          propertyTypeId: 'open',
          equals: true,
        },
      ],
      parameters: {
        orderId: { baseType: 'string', required: true },
        gateId: { baseType: 'object_reference', objectTypeId: 'ot.gate', required: true },
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
    const { exec, objects, ontologyId } = await executorHarness([gatedCreate], {
      objectTypeIds: ['ot.order', 'ot.gate'],
    });
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.gate',
      primaryKey: 'g1',
      properties: { open: true },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'createGated',
      parameters: { orderId: 'n1', gateId: 'g1' },
      principal: 'u1',
      idempotencyKey: 'precond',
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');
    await objects.update(ontologyId, 'ot.gate', 'g1', { properties: { open: false } });
    const r = await exec.approve!(paused.executionId, 'manager');
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/submission criterion/);
    expect(await objects.get(ontologyId, 'ot.order', 'n1')).toBeUndefined();
  });

  it('10+11. injected failure reverts stores and FAILED record survives', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    const objects = {
      create: async (input: Parameters<typeof inner.create>[0]) => {
        await Promise.resolve(inner.create(input));
        throw new Error('injected after create');
      },
      get: inner.get.bind(inner),
      getById: inner.getById.bind(inner),
      list: inner.list.bind(inner),
      listAll: inner.listAll.bind(inner),
      update: inner.update.bind(inner),
      delete: inner.delete.bind(inner),
    };
    const links = createMemoryLinkRepository({ clock, nextId });
    const events = createMemoryOperationalEventStore({ clock, nextId });
    const executions = createMemoryActionExecutionStore();
    const outbox = createMemoryOutboxRepository();
    const audit = createAuditLog({ clock, nextId });
    const { ontology, ontologyId } = await executorHarness([createDef], { clock, nextId });
    const uow: ActionUnitOfWork = createSnapshotUnitOfWork(
      [inner, links, events, executions, outbox],
      () => ({ objects, links, events, executions, outbox, audit }),
    );
    const innerExec = createActionExecutor({
      objects,
      links,
      ontology,
      events,
      executions,
      outbox,
      audit,
      unitOfWork: uow,
      authorize: () => ({
        decision: 'allow',
        principalEpids: [],
        resourceEpid: null,
        reason: 'ok',
      }),
      clock,
      nextId,
    });
    const exec = createFailureSurvivingExecutor({
      inner: innerExec,
      rootExecutions: executions,
      clock,
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'boom' },
      principal: 'u1',
      idempotencyKey: 'inj-1',
    });
    expect(r.status).toBe('FAILED');
    expect(await inner.get(ontologyId, 'ot.order', 'boom')).toBeUndefined();
    expect(await events.list()).toHaveLength(0);
    expect(outbox.records).toHaveLength(0);
    const stored = await executions.get(r.executionId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.error).toMatch(/injected/);
    const valid = await exec.validate({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'ok' },
      principal: 'u1',
    });
    expect(valid.valid).toBe(true);
    expect(await exec.getExecution(r.executionId)).toMatchObject({ status: 'FAILED' });
  });

  it('13. ProjectionWriter memory uses UoW, not compensation', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    const objects = {
      create: async (input: Parameters<typeof inner.create>[0]) => {
        await Promise.resolve(inner.create(input));
        throw new Error('injected after create');
      },
      get: inner.get.bind(inner),
      getById: inner.getById.bind(inner),
      list: inner.list.bind(inner),
      listAll: inner.listAll.bind(inner),
      update: inner.update.bind(inner),
      delete: inner.delete.bind(inner),
    };
    const links = createMemoryLinkRepository({ clock, nextId });
    const events = createMemoryOperationalEventStore({ clock, nextId });
    const ledger = createMemoryProjectionLedger();
    const history = createMemoryObjectHistoryStore({ clock, nextId });
    const writer = createProjectionWriter({
      objects,
      links,
      events,
      ledger,
      authorize: () => ({
        decision: 'allow',
        principalEpids: ['p'],
        resourceEpid: 'admin:projection',
        reason: 'ok',
      }),
      resourceId: 'admin:projection',
      unitOfWork: createSnapshotUnitOfWork(
        [inner, links, events, ledger, history],
        () => ({ objects, links, events, ledger }),
      ),
      clock,
    });
    await expect(
      writer.projectObject({
        ontologyId: 'o1',
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'pending' },
        source: 'erp',
        sourceEventId: 'e1',
        principal: 'svc',
      }),
    ).rejects.toThrow(/injected after create/);
    expect(await inner.get('o1', 'ot.order', '1')).toBeUndefined();
    const retry = createProjectionWriter({
      objects: inner,
      links,
      events,
      ledger,
      authorize: () => ({
        decision: 'allow',
        principalEpids: ['p'],
        resourceEpid: 'admin:projection',
        reason: 'ok',
      }),
      resourceId: 'admin:projection',
      clock,
    });
    const applied = await retry.projectObject({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'e1',
      principal: 'svc',
    });
    expect(applied.status).toBe('applied');
  });
});
