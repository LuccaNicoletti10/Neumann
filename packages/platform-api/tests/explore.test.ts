/**
 * platform-api — tests/explore.test.ts
 * GraphPattern HTTP + leitura de objetos/links sem vazar permissão.
 */
import { describe, expect, it } from 'vitest';

import { createOntologyAuthorizer } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

describe('Passo 30 — GraphPattern HTTP', () => {
  async function setup() {
    const authorizer = createOntologyAuthorizer({
      roles: { fernanda: ['financeiro'], intruso: [] },
      grants: [
        {
          role: 'financeiro',
          ontologyIds: ['*'],
          objectTypes: ['ot.customer', 'ot.sales_order'],
          linkTypes: ['lt.placed'],
          operations: ['read', 'modify'],
          actions: ['*'],
        },
      ],
    });
    const ctx = createMemoryPlatformContext({ authorizer });
    const o = await ctx.ontology.createOntology({ name: 'explore' });
    await ctx.ontology.addPropertyType(o.id, { id: 'name', displayName: 'Name', baseType: 'string' });
    await ctx.ontology.addPropertyType(o.id, { id: 'status', displayName: 'Status', baseType: 'string' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.customer',
      displayName: 'Customer',
      propertyTypeIds: ['name'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.sales_order',
      displayName: 'Sales order',
      propertyTypeIds: ['status'],
    });
    await ctx.ontology.addLinkType(o.id, {
      id: 'lt.placed',
      displayName: 'Placed',
      sourceObjectTypeId: 'ot.customer',
      targetObjectTypeId: 'ot.sales_order',
      cardinality: '1:N',
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 't' });

    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      properties: { name: 'Acme' },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.sales_order',
      primaryKey: 'SO-1',
      properties: { status: 'open' },
    });
    await ctx.links.create({
      ontologyId: o.id,
      linkTypeId: 'lt.placed',
      sourceObjectTypeId: 'ot.customer',
      sourcePrimaryKey: 'C1',
      targetObjectTypeId: 'ot.sales_order',
      targetPrimaryKey: 'SO-1',
    });

    const { app } = await createPlatformServer(ctx);
    return { app, ontologyId: o.id };
  }

  const pattern = {
    rootNodeId: 'c',
    nodes: [
      { id: 'c', objectTypeId: 'ot.customer' },
      { id: 'o', objectTypeId: 'ot.sales_order' },
    ],
    edges: [{ id: 'e1', source: 'c', target: 'o', linkTypeId: 'lt.placed' }],
  };

  it('fernanda executa o padrão; intruso recebe matches vazios (não 403)', async () => {
    const { app, ontologyId } = await setup();
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/graphPatterns/execute`,
      headers: { authorization: 'Bearer fernanda' },
      payload: { pattern },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().total).toBe(1);
    expect(ok.json().matches[0].bindings.some((b: { primaryKey: string }) => b.primaryKey === 'SO-1')).toBe(
      true,
    );

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${ontologyId}/graphPatterns/execute`,
      headers: { authorization: 'Bearer intruso' },
      payload: { pattern },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json().total).toBe(0);
    expect(denied.json().matches).toEqual([]);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.customer`,
      headers: { authorization: 'Bearer intruso' },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toEqual([]);

    await app.close();
  });
});
