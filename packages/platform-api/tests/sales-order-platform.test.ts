/**
 * platform-api — tests/sales-order-platform.test.ts
 *
 * Domain-neutral milestone proof:
 * Customer → SalesOrders → Product + approve-sales-order Action
 *
 * create/load → traverse links → ObjectSet → validate/apply action → state + audit
 */

import { describe, expect, it } from 'vitest';

import type { ActionTypeDef } from 'contracts';
import { resolveObjectSet } from 'object-set';

import { createPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

function seedSalesOntology(ctx: ReturnType<typeof createPlatformContext>) {
  const o = ctx.ontology.createOntology({
    name: 'sales',
    description: 'Neutral commerce ontology',
    createdBy: 'test',
  });

  ctx.ontology.addPropertyType(o.id, {
    id: 'pt.name',
    displayName: 'Name',
    baseType: 'string',
  });
  ctx.ontology.addPropertyType(o.id, {
    id: 'pt.email',
    displayName: 'Email',
    baseType: 'string',
  });
  ctx.ontology.addPropertyType(o.id, {
    id: 'pt.sku',
    displayName: 'SKU',
    baseType: 'string',
  });
  ctx.ontology.addPropertyType(o.id, {
    id: 'pt.amount',
    displayName: 'Amount',
    baseType: 'number',
  });
  ctx.ontology.addPropertyType(o.id, {
    id: 'pt.status',
    displayName: 'Status',
    baseType: 'string',
  });

  ctx.ontology.addObjectType(o.id, {
    id: 'ot.customer',
    displayName: 'Customer',
    propertyTypeIds: ['pt.name', 'pt.email'],
  });
  ctx.ontology.addObjectType(o.id, {
    id: 'ot.product',
    displayName: 'Product',
    propertyTypeIds: ['pt.name', 'pt.sku'],
  });
  ctx.ontology.addObjectType(o.id, {
    id: 'ot.sales-order',
    displayName: 'SalesOrder',
    propertyTypeIds: ['pt.amount', 'pt.status'],
  });

  ctx.ontology.addLinkType(o.id, {
    id: 'lt.customer-orders',
    displayName: 'Customer → SalesOrders',
    sourceObjectTypeId: 'ot.customer',
    targetObjectTypeId: 'ot.sales-order',
    cardinality: '1:N',
  });
  ctx.ontology.addLinkType(o.id, {
    id: 'lt.order-product',
    displayName: 'SalesOrder → Product',
    sourceObjectTypeId: 'ot.sales-order',
    targetObjectTypeId: 'ot.product',
    cardinality: 'N:1',
  });

  const approve: ActionTypeDef = {
    id: 'act.approve-sales-order',
    apiName: 'approve-sales-order',
    displayName: 'Approve Sales Order',
    inputObjectTypeIds: ['ot.sales-order'],
    status: 'ACTIVE',
    version: 1,
    parameters: {
      orderId: {
        baseType: 'object_reference',
        objectTypeId: 'ot.sales-order',
        required: true,
      },
      status: { baseType: 'string', required: true },
    },
    submissionCriteria: [
      {
        kind: 'property_equals',
        objectTypeId: 'ot.sales-order',
        primaryKeyParam: 'orderId',
        propertyTypeId: 'pt.status',
        equals: 'pending',
      },
    ],
    rules: [
      {
        kind: 'modify_object',
        objectTypeId: 'ot.sales-order',
        primaryKeyFromParam: 'orderId',
        setPropertiesFromParams: { 'pt.status': 'status' },
      },
    ],
    sideEffects: [
      {
        kind: 'connector_writeback',
        connectorId: 'erp-demo',
        operation: 'update_order_status',
      },
    ],
    permissions: ['actions:apply'],
  };

  ctx.ontology.addActionType(o.id, approve);
  const version = ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  ctx.actions.registerActionType(o.id, approve);
  return { ontologyId: o.id, version, approve };
}

describe('milestone — Customer / SalesOrder / Product platform', () => {
  it('create → links → ObjectSet → action → audit', async () => {
    const ctx = createPlatformContext();
    const { ontologyId } = seedSalesOntology(ctx);

    // create objects
    const customer = await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.customer',
      primaryKey: 'C-1',
      properties: { 'pt.name': 'Acme', 'pt.email': 'a@acme.test' },
      source: 'test',
    });
    const product = await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.product',
      primaryKey: 'P-1',
      properties: { 'pt.name': 'Widget', 'pt.sku': 'W-100' },
    });
    const order = await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.sales-order',
      primaryKey: 'SO-1',
      properties: { 'pt.amount': 150, 'pt.status': 'pending' },
    });
    const order2 = await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.sales-order',
      primaryKey: 'SO-2',
      properties: { 'pt.amount': 40, 'pt.status': 'pending' },
    });

    expect(customer.primaryKey).toBe('C-1');
    expect(product.objectTypeId).toBe('ot.product');

    // links
    await ctx.links.create({
      ontologyId,
      linkTypeId: 'lt.customer-orders',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C-1',
      targetObjectTypeId: 'ot.sales-order',
      targetPrimaryKey: 'SO-1',
      cardinality: '1:N',
    });
    await ctx.links.create({
      ontologyId,
      linkTypeId: 'lt.customer-orders',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C-1',
      targetObjectTypeId: 'ot.sales-order',
      targetPrimaryKey: 'SO-2',
      cardinality: '1:N',
    });
    await ctx.links.create({
      ontologyId,
      linkTypeId: 'lt.order-product',
      sourceObjectTypeId: 'ot.sales-order',
      sourcePrimaryKey: 'SO-1',
      targetObjectTypeId: 'ot.product',
      targetPrimaryKey: 'P-1',
      cardinality: 'N:1',
    });

    const ordersFromCustomer = await ctx.links.listFrom(
      ontologyId,
      'ot.customer',
      'C-1',
      'lt.customer-orders',
    );
    expect(ordersFromCustomer).toHaveLength(2);

    // ObjectSet: BASE + FILTER + SEARCH_AROUND + UNION/INTERSECT/SUBTRACT/STATIC
    const pending = await resolveObjectSet(
      {
        type: 'FILTER',
        filter: { type: 'EQUALS', property: 'pt.status', value: 'pending' },
        objectSet: { type: 'BASE', objectType: 'ot.sales-order' },
      },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(pending.map((o) => o.primaryKey).sort()).toEqual(['SO-1', 'SO-2']);

    const around = await resolveObjectSet(
      {
        type: 'SEARCH_AROUND',
        link: 'lt.customer-orders',
        objectSet: {
          type: 'STATIC',
          objectType: 'ot.customer',
          primaryKeys: ['C-1'],
        },
      },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(around).toHaveLength(2);

    const onlySo1 = await resolveObjectSet(
      {
        type: 'INTERSECT',
        objectSets: [
          { type: 'BASE', objectType: 'ot.sales-order' },
          {
            type: 'STATIC',
            objectType: 'ot.sales-order',
            primaryKeys: ['SO-1'],
          },
        ],
      },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(onlySo1).toHaveLength(1);

    const subtracted = await resolveObjectSet(
      {
        type: 'SUBTRACT',
        objectSets: [
          { type: 'BASE', objectType: 'ot.sales-order' },
          {
            type: 'STATIC',
            objectType: 'ot.sales-order',
            primaryKeys: ['SO-2'],
          },
        ],
      },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(subtracted.map((o) => o.primaryKey)).toEqual(['SO-1']);

    const unioned = await resolveObjectSet(
      {
        type: 'UNION',
        objectSets: [
          {
            type: 'STATIC',
            objectType: 'ot.sales-order',
            primaryKeys: ['SO-1'],
          },
          {
            type: 'STATIC',
            objectType: 'ot.sales-order',
            primaryKeys: ['SO-1', 'SO-2'],
          },
        ],
      },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(unioned).toHaveLength(2);

    // validate + apply action
    const validation = await ctx.actions.validate({
      ontologyId,
      actionApiName: 'approve-sales-order',
      parameters: { orderId: 'SO-1', status: 'approved' },
      principal: 'user-alice',
    });
    expect(validation.valid).toBe(true);

    const applied = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'approve-sales-order',
      parameters: { orderId: 'SO-1', status: 'approved' },
      principal: 'user-alice',
      idempotencyKey: 'approve-SO-1',
    });
    expect(applied.status).toBe('SUCCEEDED');
    expect(applied.auditEntryId).toBeTruthy();

    const updated = await ctx.objects.get(ontologyId, 'ot.sales-order', 'SO-1');
    expect(updated?.properties['pt.status']).toBe('approved');
    expect(updated?.version).toBe(order.version + 1);

    // audit persisted
    const auditEntries = ctx.audit.list();
    expect(auditEntries.some((e) => e.id === applied.auditEntryId)).toBe(true);
    expect(ctx.audit.verify().ok).toBe(true);

    // operational events
    const actionEvents = ctx.events.list({ kind: 'ActionApplied' });
    expect(actionEvents.length).toBeGreaterThanOrEqual(1);
    expect(ctx.events.list({ kind: 'ObjectModified' }).length).toBeGreaterThanOrEqual(1);
    expect(
      ctx.events.list({ kind: 'ExternalWritebackRequested' }).length,
    ).toBeGreaterThanOrEqual(1);

    // idempotency
    const again = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'approve-sales-order',
      parameters: { orderId: 'SO-1', status: 'approved' },
      principal: 'user-alice',
      idempotencyKey: 'approve-SO-1',
    });
    expect(again.executionId).toBe(applied.executionId);

    // criteria reject already-approved
    const rejected = await ctx.actions.validate({
      ontologyId,
      actionApiName: 'approve-sales-order',
      parameters: { orderId: 'SO-1', status: 'approved' },
      principal: 'user-alice',
    });
    expect(rejected.valid).toBe(false);

    // HTTP /api/v2 smoke
    const { app } = await createPlatformServer(ctx);
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.sales-order`,
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as { data: { primaryKey: string }[] };
    expect(body.data.some((o) => o.primaryKey === 'SO-2')).toBe(true);

    const loadRes = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/objectSets/loadObjects`,
      payload: {
        objectSet: {
          type: 'FILTER',
          filter: { type: 'EQUALS', property: 'pt.status', value: 'pending' },
          objectSet: { type: 'BASE', objectType: 'ot.sales-order' },
        },
      },
    });
    expect(loadRes.statusCode).toBe(200);
    const loaded = loadRes.json() as { data: { primaryKey: string }[] };
    expect(loaded.data.map((o) => o.primaryKey)).toEqual(['SO-2']);

    const linkRes = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.customer/C-1/links/lt.customer-orders`,
    });
    expect(linkRes.statusCode).toBe(200);
    expect((linkRes.json() as { data: unknown[] }).data).toHaveLength(2);

    await app.close();
  });

  it('platform packages do not import apps', async () => {
    // Structural guard: this test file lives in packages/platform-api and only
    // imports workspace packages — never apps/*.
    const forbidden = ['apps/', 'production_planning', 'forecast', 'netting', 'plan_line'];
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    );
    for (const token of forbidden) {
      expect(src.includes(token)).toBe(false);
    }
  });
});
