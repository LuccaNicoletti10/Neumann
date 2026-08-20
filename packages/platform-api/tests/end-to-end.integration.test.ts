/**
 * platform-api — tests/end-to-end.integration.test.ts
 * Kernel cycle without file connector: ontology → projector write → action
 * → history + execution + outbox drain → failed execution still queryable.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionTypeDef } from 'contracts';
import { createOutboxWorker, createPgOutboxRepository, createSqlMirrorWritebackHandler } from 'event-bus';
import { tryOpenIsolatedPg } from 'object-platform';
import { createOntologyAuthorizer } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

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
  sideEffects: [{ kind: 'connector_writeback', connectorId: 'erp', operation: 'update' }],
};

const boom: ActionTypeDef = {
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

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('platform E2E (no file connector)', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('projector write, human 403, action, history, outbox, failed execution', async () => {
    if (!db) return;

    const authz = createOntologyAuthorizer({
      roles: {
        alice: ['operator'],
        lucca: ['admin'],
        'svc-projector': ['servico'],
      },
      grants: [
        {
          role: 'admin',
          ontologyIds: ['*'],
          objectTypes: ['*'],
          linkTypes: ['*'],
          actions: ['*'],
          functions: ['*'],
          adminResources: ['*'],
          operations: ['read', 'modify'],
        },
        {
          role: 'servico',
          ontologyIds: ['*'],
          objectTypes: ['*'],
          linkTypes: ['*'],
          actions: ['*'],
          functions: ['*'],
          adminResources: ['*'],
          operations: ['read', 'modify'],
        },
        {
          role: 'operator',
          ontologyIds: ['*'],
          objectTypes: ['ot.order', 'ot.customer'],
          actions: ['approve', 'boom'],
          operations: ['read', 'modify'],
        },
      ],
    });

    const ctx = await createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      authorizer: authz,
    });
    const { app } = await createPlatformServer(ctx);

    const ontoRes = await app.inject({
      method: 'POST',
      url: '/api/v2/ontologies',
      headers: { authorization: 'Bearer svc-projector' },
      payload: { name: 'e2e' },
    });
    expect(ontoRes.statusCode).toBe(201);
    const ontologyId = ontoRes.json().id as string;

    await ctx.ontology.addPropertyType(ontologyId, {
      id: 'name',
      displayName: 'Name',
      baseType: 'string',
      validators: [{ kind: 'required' }],
    });
    await ctx.ontology.addPropertyType(ontologyId, {
      id: 'status',
      displayName: 'Status',
      baseType: 'string',
      validators: [{ kind: 'required' }],
    });
    await ctx.ontology.addObjectType(ontologyId, {
      id: 'ot.customer',
      displayName: 'Customer',
      propertyTypeIds: ['name'],
    });
    await ctx.ontology.addObjectType(ontologyId, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: ['status'],
    });
    await ctx.ontology.addLinkType(ontologyId, {
      id: 'lt.customer_order',
      displayName: 'Customer orders',
      sourceObjectTypeId: 'ot.customer',
      targetObjectTypeId: 'ot.order',
      cardinality: '1:N',
    });
    await ctx.ontology.addActionType(ontologyId, approve);
    await ctx.ontology.addActionType(ontologyId, boom);
    await ctx.ontology.commit({ ontologyId, createdBy: 'svc-projector' });

    const customer = await ctx.projections.projectObject({
      ontologyId,
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      properties: { name: 'Acme' },
      source: 'e2e-projector',
      sourceEventId: 'cust-C1',
      principal: 'svc-projector',
    });
    expect(customer.status).toBe('applied');

    const order = await ctx.projections.projectObject({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: 'O1',
      properties: { status: 'pending' },
      source: 'e2e-projector',
      sourceEventId: 'ord-O1',
      principal: 'svc-projector',
    });
    expect(order.status).toBe('applied');
    const orderId = order.object!.id;

    const link = await ctx.projections.projectLink({
      ontologyId,
      linkTypeId: 'lt.customer_order',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C1',
      targetObjectTypeId: 'ot.order',
      targetPrimaryKey: 'O1',
      source: 'e2e-projector',
      sourceEventId: 'link-C1-O1',
      principal: 'svc-projector',
    });
    expect(link.status).toBe('applied');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.order`,
      headers: { authorization: 'Bearer alice' },
      payload: { primaryKey: 'O2', properties: { status: 'pending' } },
    });
    expect(forbidden.statusCode).toBe(405);
    expect(forbidden.json().errorName).toBe('ActionRequired');

    const applied = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/actions/approve/apply`,
      headers: { authorization: 'Bearer alice' },
      payload: {
        parameters: { orderId: 'O1', status: 'ok' },
        idempotencyKey: 'e2e-approve',
        expectedObjectVersions: { 'ot.order::O1': 1 },
      },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().status).toBe('SUCCEEDED');
    const executionId = applied.json().executionId as string;

    const trail = await ctx.history.listByObject(orderId);
    expect(trail.length).toBeGreaterThanOrEqual(2);
    expect(trail[0]?.operation).toBe('create');
    expect(trail[0]?.principal).toBe('svc-projector');
    expect(trail[1]?.operation).toBe('update');
    expect(trail[1]?.properties.status).toBe('ok');
    expect(trail[1]?.principal).toBe('alice');

    const exec = await ctx.actions.getExecution(executionId);
    expect(exec?.status).toBe('SUCCEEDED');

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
    const queued = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM erp_writeback_queue`,
    );
    expect(Number(queued.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    const failed = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/actions/boom/apply`,
      headers: { authorization: 'Bearer alice' },
      payload: {
        parameters: { orderId: 'boom-1', missingId: 'does-not-exist' },
        idempotencyKey: 'e2e-boom',
        expectedObjectVersions: { 'ot.order::does-not-exist': 1 },
      },
    });
    expect(failed.json().status).toBe('FAILED');
    expect(await ctx.objects.get(ontologyId, 'ot.order', 'boom-1')).toBeUndefined();
    const failedExec = await ctx.actions.getExecution(failed.json().executionId as string);
    expect(failedExec?.status).toBe('FAILED');

    const asOfCreate = await ctx.history.asOf(
      ontologyId,
      'ot.order',
      'O1',
      trail[0]!.createdAt,
    );
    expect(asOfCreate?.properties.status).toBe('pending');
    expect(asOfCreate?.operation).toBe('create');
    const asOfNow = await ctx.history.asOf(
      ontologyId,
      'ot.order',
      'O1',
      trail[1]!.createdAt,
    );
    expect(asOfNow?.properties.status).toBe('ok');
    expect(asOfNow?.operation).toBe('update');

    await app.close();
  });
});
