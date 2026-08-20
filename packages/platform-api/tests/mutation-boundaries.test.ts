/**
 * Public HTTP cannot write objects/links; Actions and ProjectionWriter can.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { ProjectionDeniedError } from 'object-platform';

describe('mutation boundaries', () => {
  it('POST/PUT/DELETE objects and POST links do not write', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'mut' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: [],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    const { app } = await createPlatformServer(ctx);
    const post = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing`,
      payload: { primaryKey: '1', properties: {} },
    });
    expect(post.statusCode).toBe(405);
    expect(post.json().errorName).toBe('ActionRequired');
    expect(await ctx.objects.get(o.id, 'ot.thing', '1')).toBeUndefined();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing/1`,
      payload: { properties: { n: 1 } },
    });
    expect(put.statusCode).toBe(405);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing/1`,
    });
    expect(del.statusCode).toBe(405);

    const link = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/objects/ot.thing/1/links/lt.x`,
      payload: { targetObjectType: 'ot.thing', targetPrimaryKey: '2' },
    });
    expect(link.statusCode).toBe(405);
    await app.close();
  });

  it('authorized action writes once; duplicate key replays; deny and stale write zero', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'act' });
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
    await ctx.ontology.addActionType(o.id, approve);
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    await ctx.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'seed',
      sourceEventId: 'seed-1',
      principal: 'svc',
    });

    const first = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'alice',
      idempotencyKey: 'a1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(first.status).toBe('SUCCEEDED');
    const dup = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'alice',
      idempotencyKey: 'a1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(dup.executionId).toBe(first.executionId);
    expect((await ctx.objects.get(o.id, 'ot.order', '1'))?.version).toBe(2);

    const denyCtx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    const denyO = await denyCtx.ontology.createOntology({ name: 'deny' });
    await denyCtx.ontology.addObjectType(denyO.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: [],
    });
    await denyCtx.ontology.addActionType(denyO.id, approve);
    await denyCtx.ontology.commit({ ontologyId: denyO.id, createdBy: 't' });
    const denied = await denyCtx.actions.apply({
      ontologyId: denyO.id,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'nope' },
      principal: 'eve',
      idempotencyKey: 'deny',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(denied.status).toBe('DENIED');

    const stale = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'late' },
      principal: 'alice',
      idempotencyKey: 'stale',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(stale.status).toBe('FAILED');
    expect((await ctx.objects.get(o.id, 'ot.order', '1'))?.properties.status).toBe('ok');
  });

  it('projection deny does not write; missing idempotencyKey does not mutate', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    const o = await ctx.ontology.createOntology({ name: 'd' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: [],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    await expect(
      ctx.projections.projectObject({
        ontologyId: o.id,
        objectTypeId: 'ot.thing',
        primaryKey: '1',
        properties: {},
        source: 'erp',
        sourceEventId: 'x',
        principal: 'eve',
      }),
    ).rejects.toBeInstanceOf(ProjectionDeniedError);
    expect(await ctx.objects.get(o.id, 'ot.thing', '1')).toBeUndefined();
  });

  it('HTTP apply without idempotencyKey does not write', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'key' });
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
    await ctx.ontology.addActionType(o.id, approve);
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    await ctx.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'seed',
      sourceEventId: 'seed-http',
      principal: 'svc',
    });
    const { app } = await createPlatformServer(ctx);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/actions/approve/apply`,
      payload: { parameters: { orderId: '1', status: 'ok' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('FAILED');
    expect(res.json().error).toMatch(/idempotencyKey/);
    expect((await ctx.objects.get(o.id, 'ot.order', '1'))?.properties.status).toBe('pending');
    await app.close();
  });

  it('HTTP actionTypes write ontology only; projection delete uses bound principal', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const o = await ctx.ontology.createOntology({ name: 'at' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.thing',
      displayName: 'Thing',
      propertyTypeIds: [],
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });
    const { app } = await createPlatformServer(ctx);
    const created = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/actionTypes`,
      payload: {
        id: 'act.x',
        apiName: 'x',
        displayName: 'X',
        inputObjectTypeIds: ['ot.thing'],
        parameters: {},
        rules: [],
      },
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/actionTypes`,
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json().data as { id: string }[]).some((t) => t.id === 'act.x')).toBe(true);
    const tree = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/actions/x/parameter-tree`,
      payload: { parameters: {} },
    });
    expect(tree.statusCode).toBe(200);
    await app.close();

    await ctx.projections.projectObject({
      ontologyId: o.id,
      objectTypeId: 'ot.thing',
      primaryKey: '1',
      properties: {},
      source: 'seed',
      sourceEventId: 'seed-obj',
      principal: 'svc',
    });
    const del = await ctx.projections.deleteProjectedObject({
      ontologyId: o.id,
      objectTypeId: 'ot.thing',
      primaryKey: '1',
      source: 'seed',
      sourceEventId: 'del-1',
      principal: 'svc',
    });
    expect(del.status).toBe('applied');
    expect(await ctx.objects.get(o.id, 'ot.thing', '1')).toBeUndefined();
  });
});
