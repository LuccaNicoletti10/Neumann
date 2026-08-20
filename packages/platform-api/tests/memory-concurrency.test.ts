/**
 * platform-api — tests/memory-concurrency.test.ts
 *
 * PROMPT 09 cases 1–5. The memory UnitOfWork must not behave like a global
 * snapshot: a rollback may only undo the transaction that failed.
 */
import { describe, expect, it } from 'vitest';

import {
  createMemoryProjectionLedger,
  createMemoryTransactionBoundary,
  NestedMemoryTransactionError,
  VersionConflictError,
} from 'object-platform';

import { createMemoryPlatformContext, type PlatformContext } from '../src/core/context.js';

const ONT_NAME = 'concurrency';

async function seed(ctx: PlatformContext): Promise<string> {
  const o = await ctx.ontology.createOntology({ name: ONT_NAME });
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
  await ctx.ontology.addActionType(o.id, {
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
    sideEffects: [
      { kind: 'connector_writeback' as const, connectorId: 'erp', operation: 'upsert' },
    ],
  });
  // Second rule re-creates a primary key that already exists: the repository
  // throws after the first rule already mutated an object.
  await ctx.ontology.addActionType(o.id, {
    id: 'act.approve-then-fail',
    apiName: 'approveThenFail',
    displayName: 'Approve then fail',
    inputObjectTypeIds: ['ot.order'],
    parameters: {
      orderId: { baseType: 'object_reference' as const, objectTypeId: 'ot.order', required: true },
      duplicateId: { baseType: 'string' as const, required: true },
      status: { baseType: 'string' as const, required: true },
    },
    rules: [
      {
        kind: 'modify_object' as const,
        objectTypeId: 'ot.order',
        primaryKeyFromParam: 'orderId',
        setPropertiesFromParams: { status: 'status' },
      },
      {
        kind: 'create_object' as const,
        objectTypeId: 'ot.order',
        primaryKeyFromParam: 'duplicateId',
        propertiesFromParams: { status: 'status' },
      },
    ],
    sideEffects: [
      { kind: 'connector_writeback' as const, connectorId: 'erp', operation: 'upsert' },
    ],
  });
  await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
  return o.id;
}

function project(ctx: PlatformContext, ontologyId: string, pk: string, status: string, evt: string) {
  return ctx.projections.projectObject({
    ontologyId,
    objectTypeId: 'ot.order',
    primaryKey: pk,
    properties: { status },
    source: 'erp',
    sourceEventId: evt,
    principal: 'svc',
  });
}

/** A batch whose second effect always fails: stale CAS on a fresh object. */
function failingBatch(ctx: PlatformContext, ontologyId: string, pk: string, evt: string) {
  return ctx.projections.projectBatch({
    source: 'erp',
    ontologyId,
    sourceEventId: evt,
    principal: 'svc',
    effects: [
      {
        kind: 'project_object',
        cmd: {
          ontologyId,
          objectTypeId: 'ot.order',
          primaryKey: pk,
          properties: { status: 'ghost' },
          source: 'erp',
          sourceEventId: evt,
          principal: 'svc',
        },
      },
      {
        kind: 'delete_object',
        cmd: {
          ontologyId,
          objectTypeId: 'ot.order',
          primaryKey: pk,
          source: 'erp',
          sourceEventId: evt,
          principal: 'svc',
          expectedVersion: 4242,
        },
      },
    ],
  });
}

describe('PROMPT 09 case 1–3 — memory UnitOfWork isolation', () => {
  it('case 1: A commits, B fails — A survives and B leaves nothing', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);

    const a = project(ctx, ontologyId, 'A', 'kept', 'evt-a');
    const b = failingBatch(ctx, ontologyId, 'B', 'evt-b');
    const [ra, rb] = await Promise.allSettled([a, b]);

    expect(ra.status).toBe('fulfilled');
    expect(rb.status).toBe('rejected');
    expect((await ctx.objects.get(ontologyId, 'ot.order', 'A'))?.properties.status).toBe('kept');
    expect(await ctx.objects.get(ontologyId, 'ot.order', 'B')).toBeUndefined();
  });

  it('case 2: B fails first, A commits after — A survives', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);

    const b = failingBatch(ctx, ontologyId, 'B', 'evt-b');
    const a = project(ctx, ontologyId, 'A', 'kept', 'evt-a');
    const [rb, ra] = await Promise.allSettled([b, a]);

    expect(rb.status).toBe('rejected');
    expect(ra.status).toBe('fulfilled');
    expect((await ctx.objects.get(ontologyId, 'ot.order', 'A'))?.properties.status).toBe('kept');
    expect(await ctx.objects.get(ontologyId, 'ot.order', 'B')).toBeUndefined();
  });

  it('case 3: two successful transactions on one object do not lose an update', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);
    await project(ctx, ontologyId, 'A', 'v1', 'evt-seed');

    // WHY no expectedVersion: both writers race for the same row. Serialized
    // commits must apply both, so the final version is seed + 2.
    const [first, second] = await Promise.all([
      project(ctx, ontologyId, 'A', 'v2', 'evt-1'),
      project(ctx, ontologyId, 'A', 'v3', 'evt-2'),
    ]);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');

    const record = await ctx.objects.get(ontologyId, 'ot.order', 'A');
    expect(record?.version).toBe(3);
    const trail = await ctx.history.listByObject(record!.id);
    expect(trail.map((e) => e.version)).toEqual([1, 2, 3]);
  });

  it('rejects a nested UnitOfWork instead of deadlocking', async () => {
    const ledger = createMemoryProjectionLedger();
    const boundary = createMemoryTransactionBoundary([ledger]);
    const uow = boundary.unitOfWork(() => ledger);
    await expect(
      uow.run(async () => {
        await uow.run(async () => undefined);
      }),
    ).rejects.toBeInstanceOf(NestedMemoryTransactionError);
  });
});

describe('PROMPT 09 case 4 — rollback does not release another claim', () => {
  it('restore abandons only the waiters opened by the aborted run', async () => {
    const ledger = createMemoryProjectionLedger();
    const foreign = await ledger.claim({
      source: 'other',
      ontologyId: 'o1',
      sourceEventId: 'foreign',
      payloadHash: 'h-foreign',
      operation: 'project_object',
    });
    expect(foreign.claimed).toBe(true);

    const boundary = createMemoryTransactionBoundary([ledger]);
    const uow = boundary.unitOfWork(() => ledger);
    await expect(
      uow.run(async (store) => {
        const mine = await store.claim({
          source: 'erp',
          ontologyId: 'o1',
          sourceEventId: 'mine',
          payloadHash: 'h-mine',
          operation: 'project_object',
        });
        expect(mine.claimed).toBe(true);
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');

    // My claim was released: a retry claims it again.
    const retry = await ledger.claim({
      source: 'erp',
      ontologyId: 'o1',
      sourceEventId: 'mine',
      payloadHash: 'h-mine',
      operation: 'project_object',
    });
    expect(retry.claimed).toBe(true);

    // The foreign claim is still in flight: a second caller must block on it,
    // not observe it as abandoned and steal the key.
    let settled = false;
    const contender = ledger
      .claim({
        source: 'other',
        ontologyId: 'o1',
        sourceEventId: 'foreign',
        payloadHash: 'h-foreign',
        operation: 'project_object',
      })
      .then((r) => {
        settled = true;
        return r;
      });
    await Promise.resolve();
    expect(settled).toBe(false);

    await ledger.complete({ ...foreign.record, result: foreign.record.result });
    const observed = await contender;
    expect(observed.claimed).toBe(false);
  });
});

describe('PROMPT 09 case 5 — Action rollback restores every store', () => {
  it('a throw after the first rule restores history, audit, outbox and events', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);
    const seeded = await project(ctx, ontologyId, '1', 'pending', 'evt-seed');
    const objectId = seeded.object!.id;

    const before = {
      history: (await ctx.history.listByObject(objectId)).length,
      audit: (await ctx.audit.list()).length,
      outbox: (await ctx.outbox.listRequests()).length,
      events: (await ctx.events.list()).length,
    };

    const failed = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'approveThenFail',
      parameters: { orderId: '1', duplicateId: '1', status: 'never' },
      principal: 'alice',
      idempotencyKey: 'rollback-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(failed.status).toBe('FAILED');

    expect((await ctx.objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
    expect((await ctx.objects.get(ontologyId, 'ot.order', '1'))?.version).toBe(1);
    expect((await ctx.history.listByObject(objectId)).length).toBe(before.history);
    expect((await ctx.audit.list()).length).toBe(before.audit);
    expect((await ctx.outbox.listRequests()).length).toBe(before.outbox);
    expect((await ctx.events.list()).length).toBe(before.events);

    // The failure itself is durable: the executor records it outside the UoW.
    const execution = await ctx.executions.get(failed.executionId);
    expect(execution?.status).toBe('FAILED');
  });

  it('a stale CAS is audited as ActionFailed without mutating anything', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);
    const seeded = await project(ctx, ontologyId, '1', 'pending', 'evt-seed');
    const objectId = seeded.object!.id;
    const before = {
      history: (await ctx.history.listByObject(objectId)).length,
      audit: (await ctx.audit.list()).length,
      outbox: (await ctx.outbox.listRequests()).length,
    };

    const failed = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'never' },
      principal: 'alice',
      idempotencyKey: 'cas-1',
      expectedObjectVersions: { 'ot.order::1': 99 },
    });
    expect(failed.status).toBe('FAILED');

    expect((await ctx.objects.get(ontologyId, 'ot.order', '1'))?.version).toBe(1);
    expect((await ctx.history.listByObject(objectId)).length).toBe(before.history);
    expect((await ctx.outbox.listRequests()).length).toBe(before.outbox);
    // WHY the audit grows: a refused mutation is a governed decision and must
    // stay observable. Only the effects of the mutation roll back.
    expect((await ctx.audit.list()).length).toBe(before.audit + 1);
  });

  it('a successful action writes history, event, audit and outbox exactly once', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);
    const seeded = await project(ctx, ontologyId, '1', 'pending', 'evt-seed');
    const objectId = seeded.object!.id;
    const before = {
      history: (await ctx.history.listByObject(objectId)).length,
      audit: (await ctx.audit.list()).length,
      outbox: (await ctx.outbox.listRequests()).length,
    };

    const ok = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'approved' },
      principal: 'alice',
      idempotencyKey: 'ok-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(ok.status).toBe('SUCCEEDED');

    expect((await ctx.history.listByObject(objectId)).length).toBe(before.history + 1);
    expect((await ctx.audit.list()).length).toBeGreaterThan(before.audit);
    expect((await ctx.outbox.listRequests()).length).toBe(before.outbox + 1);

    // Replay of the same key adds nothing.
    const replay = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'approved' },
      principal: 'alice',
      idempotencyKey: 'ok-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(replay.executionId).toBe(ok.executionId);
    expect((await ctx.history.listByObject(objectId)).length).toBe(before.history + 1);
    expect((await ctx.outbox.listRequests()).length).toBe(before.outbox + 1);
  });

  it('stale CAS is a typed conflict, not a 500-shaped error', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seed(ctx);
    await project(ctx, ontologyId, '1', 'pending', 'evt-seed');
    await expect(
      ctx.objects.update(ontologyId, 'ot.order', '1', {
        properties: { status: 'x' },
        expectedVersion: 42,
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});
