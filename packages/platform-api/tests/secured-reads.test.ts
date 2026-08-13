/**
 * platform-api — tests/secured-reads.test.ts
 * ObjectSet / history / links / aggregate go through the same authorizer.
 */
import { describe, expect, it } from 'vitest';

import { createOntologyAuthorizer } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

describe('SecuredReads — no bypass via ObjectSet/history/links', () => {
  async function setup() {
    const authorizer = createOntologyAuthorizer({
      roles: {
        fernanda: ['financeiro'],
        intruso: [],
        'svc-projector': ['servico'],
      },
      grants: [
        {
          role: 'financeiro',
          objectTypes: ['ot.order'],
          operations: ['read', 'modify'],
          hiddenProperties: ['secret'],
          actions: ['*'],
        },
        {
          role: 'servico',
          objectTypes: ['*'],
          operations: ['read', 'modify'],
          actions: ['*'],
        },
      ],
    });
    const ctx = createMemoryPlatformContext({ authorizer });
    const o = await ctx.ontology.createOntology({ name: 'sec' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'status',
      displayName: 'Status',
      baseType: 'string',
    });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'secret',
      displayName: 'Secret',
      baseType: 'string',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.order',
      displayName: 'Order',
      propertyTypeIds: ['status', 'secret'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.employee',
      displayName: 'Employee',
      propertyTypeIds: ['status'],
    });
    await ctx.ontology.addLinkType(o.id, {
      id: 'lt.staff',
      displayName: 'Staff',
      sourceObjectTypeId: 'ot.order',
      targetObjectTypeId: 'ot.employee',
      cardinality: '1:N',
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });

    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: 'O1',
      properties: { status: 'open', secret: 'hidden' },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.employee',
      primaryKey: 'E1',
      properties: { status: 'hired' },
    });
    await ctx.links.create({
      ontologyId: o.id,
      linkTypeId: 'lt.staff',
      sourceObjectTypeId: 'ot.order',
      sourcePrimaryKey: 'O1',
      targetObjectTypeId: 'ot.employee',
      targetPrimaryKey: 'E1',
    });

    const order = (await ctx.objects.get(o.id, 'ot.order', 'O1'))!;
    await ctx.history.append({
      objectId: order.id,
      ontologyId: o.id,
      objectTypeId: 'ot.order',
      primaryKey: 'O1',
      version: 1,
      properties: { status: 'open', secret: 'hidden' },
      deleted: false,
      operation: 'create',
    });

    const { app } = await createPlatformServer(ctx);
    return { app, ontologyId: o.id, orderId: order.id };
  }

  it('intruso cannot ObjectSet/aggregate a readable-looking Customer bypass', async () => {
    const { app, ontologyId } = await setup();
    const load = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/objectSets/loadObjects`,
      headers: { authorization: 'Bearer intruso' },
      payload: { objectSet: { type: 'BASE', objectType: 'ot.order' } },
    });
    expect(load.statusCode).toBe(403);

    const agg = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/objectSets/aggregate`,
      headers: { authorization: 'Bearer intruso' },
      payload: {
        objectSet: { type: 'BASE', objectType: 'ot.order' },
        aggregations: [{ kind: 'count' }],
      },
    });
    expect(agg.statusCode).toBe(403);
    await app.close();
  });

  it('fernanda ObjectSet redacts hidden properties; history/links enforce read', async () => {
    const { app, ontologyId, orderId } = await setup();
    const load = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/objectSets/loadObjects`,
      headers: { authorization: 'Bearer fernanda' },
      payload: { objectSet: { type: 'BASE', objectType: 'ot.order' } },
    });
    expect(load.statusCode).toBe(200);
    const row = load.json().data[0];
    expect(row.properties.status).toBe('open');
    expect(row.properties.secret).toBeUndefined();

    const hist = await app.inject({
      method: 'GET',
      url: `/api/v2/objects/${orderId}/history`,
      headers: { authorization: 'Bearer intruso' },
    });
    expect(hist.statusCode).toBe(403);

    const histOk = await app.inject({
      method: 'GET',
      url: `/api/v2/objects/${orderId}/history`,
      headers: { authorization: 'Bearer fernanda' },
    });
    expect(histOk.statusCode).toBe(200);
    expect(histOk.json().data[0]?.properties.secret).toBeUndefined();

    const linksDenied = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.order/O1/links/lt.staff`,
      headers: { authorization: 'Bearer fernanda' },
    });
    expect(linksDenied.statusCode).toBe(403);

    await app.close();
  });
});
