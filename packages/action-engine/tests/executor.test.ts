/**
 * action-engine — tests/executor.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';

import { createActionExecutor } from '../src/index.js';
import { executorHarness } from './executor-harness.js';
import { allowAllAuthorize } from './test-policy.js';

const approve = {
  id: 'act.approve',
  apiName: 'approve',
  displayName: 'Approve',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'object_reference' as const, objectTypeId: 'ot.order', required: true },
    status: { baseType: 'string' as const, required: true },
  },
  rules: [
    {
      kind: 'modify_object' as const,
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      setPropertiesFromParams: { status: 'status' },
    },
  ],
};

const createOrder = {
  id: 'act.create',
  apiName: 'createOrder',
  displayName: 'Create',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'string' as const, required: true },
  },
  rules: [
    {
      kind: 'create_object' as const,
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      propertiesFromParams: {},
    },
  ],
};

describe('ActionExecutor', () => {
  it('mutating action without idempotencyKey fails closed with zero writes', async () => {
    const { exec, objects, ontologyId } = await executorHarness([approve]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/idempotencyKey/);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
    expect(await exec.getExecution(r.executionId)).toBeUndefined();
  });

  it('mutating action without expectedObjectVersions fails closed with zero writes', async () => {
    const { exec, objects, ontologyId } = await executorHarness([approve]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'no-cas',
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/expectedObjectVersions/);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
    expect(await exec.getExecution(r.executionId)).toBeUndefined();
  });

  it('refuses missing authorize (fail-closed)', () => {
    const objects = createMemoryObjectRepository();
    const links = createMemoryLinkRepository();
    expect(() =>
      createActionExecutor({ objects, links } as never),
    ).toThrow(/authorize/);
  });

  it('refuses missing ontology (fail-closed)', () => {
    const objects = createMemoryObjectRepository();
    const links = createMemoryLinkRepository();
    expect(() =>
      createActionExecutor({ objects, links, authorize: allowAllAuthorize }),
    ).toThrow(/ontology/);
  });

  it('production refuses missing durable stores', async () => {
    const { ontology } = await executorHarness([approve]);
    const objects = createMemoryObjectRepository();
    const links = createMemoryLinkRepository();
    expect(() =>
      createActionExecutor({
        objects,
        links,
        ontology,
        authorize: allowAllAuthorize,
        mode: 'production',
      }),
    ).toThrow(/durable/);
  });

  it('validate → apply → modify + audit', async () => {
    const { exec, objects, audit, ontologyId } = await executorHarness([
      {
        ...approve,
        submissionCriteria: [
          {
            kind: 'property_equals',
            objectTypeId: 'ot.order',
            primaryKeyParam: 'orderId',
            propertyTypeId: 'status',
            equals: 'pending',
          },
        ],
      },
    ]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });

    const v = await exec.validate({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(v.valid).toBe(true);

    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'approve-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(r.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('ok');
    expect((await audit.list()).some((e) => e.id === r.auditEntryId)).toBe(true);
  });

  it('expectedObjectVersions is enforced on the mutation CAS, not only pre-check', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    let seenExpected: number | undefined;
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
        seenExpected = input.expectedVersion;
        return inner.update(ontologyId, objectTypeId, primaryKey, input);
      },
      delete: inner.delete.bind(inner),
    };
    const { exec, ontologyId } = await executorHarness([approve], { objects, clock, nextId });
    await inner.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    await inner.update(ontologyId, 'ot.order', '1', { properties: { status: 'pending' } });

    const stale = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'stale-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(stale.status).toBe('FAILED');
    expect(stale.error).toMatch(/version conflict/i);
    expect((await inner.get(ontologyId, 'ot.order', '1'))?.version).toBe(2);

    const ok = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'ok-1',
      expectedObjectVersions: { 'ot.order::1': 2 },
    });
    expect(ok.status).toBe('SUCCEEDED');
    expect(seenExpected).toBe(2);
  });

  it('P0-2: apply failure keeps original executionId as FAILED (no zombie RUNNING)', async () => {
    const { exec, objects, ontologyId } = await executorHarness([createOrder]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: 'dup',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'dup' },
      principal: 'u1',
      idempotencyKey: 'dup-create',
    });
    expect(r.status).toBe('FAILED');
    expect(r.executionId).toMatch(/^aex-/);
    const stored = await exec.getExecution(r.executionId);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('FAILED');
    expect(stored?.error).toMatch(/already exists/i);
  });

  it('P0-2: repeating idempotencyKey after failure returns the original FAILED execution', async () => {
    const { exec, objects, ontologyId } = await executorHarness([createOrder]);
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
      idempotencyKey: 'fail-once',
    });
    expect(first.status).toBe('FAILED');
    const second = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'dup' },
      principal: 'u1',
      idempotencyKey: 'fail-once',
    });
    expect(second.executionId).toBe(first.executionId);
    expect(second.status).toBe('FAILED');
    const stored = await exec.getExecution(first.executionId);
    expect(stored?.status).toBe('FAILED');
  });

  it('P0-4: omitted optional params are not written as property keys', async () => {
    const { exec, objects, ontologyId } = await executorHarness([
      {
        id: 'act.create',
        apiName: 'createOrder',
        displayName: 'Create',
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
      },
    ]);
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'createOrder',
      parameters: { orderId: 'n1' },
      principal: 'u1',
      idempotencyKey: 'opt-create',
    });
    expect(r.status).toBe('SUCCEEDED');
    const obj = await objects.get(ontologyId, 'ot.order', 'n1');
    expect(obj).toBeDefined();
    expect('note' in (obj?.properties ?? {})).toBe(false);
  });

  it('P1-4: requiresApproval pauses then approve resumes; reject is terminal', async () => {
    const { exec, objects, ontologyId } = await executorHarness(
      [
        {
          id: 'act.discount',
          apiName: 'discount',
          displayName: 'Discount',
          inputObjectTypeIds: ['ot.order'],
          requiresApproval: true,
          approvals: { required: true, approverPolicy: 'manager' },
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
        },
      ],
      {
        authorize: (req) => ({
          decision: req.principal === 'eve' ? 'deny' : 'allow',
          principalEpids: [],
          resourceEpid: null,
          reason: req.principal === 'eve' ? 'denied' : 'ok',
        }),
      },
    );

    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'd1', note: '10%' },
      principal: 'u1',
      idempotencyKey: 'disc-d1',
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');
    expect(await objects.get(ontologyId, 'ot.order', 'd1')).toBeUndefined();

    await expect(exec.approve!(paused.executionId, 'u1')).rejects.toThrow(/self-approval/);
    await expect(exec.approve!(paused.executionId, 'eve')).rejects.toThrow(/denied/);

    const done = await exec.approve!(paused.executionId, 'manager');
    expect(done.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', 'd1'))?.properties.note).toBe('10%');

    const paused2 = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'd2' },
      principal: 'u1',
      idempotencyKey: 'disc-d2',
    });
    const rejected = await exec.reject!(paused2.executionId, 'manager');
    expect(rejected.status).toBe('REJECTED');
    const again = await exec.approve!(paused2.executionId, 'manager');
    expect(again.status).toBe('REJECTED');
  });
});
