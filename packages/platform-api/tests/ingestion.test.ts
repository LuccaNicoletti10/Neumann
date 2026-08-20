/**
 * platform-api — ctx.ingestion is the connector pipeline (ADR-0016 / ADR-0017).
 */
import { describe, expect, it } from 'vitest';

import { sourceFromEnvelopes } from 'ingestion-runtime';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { listCollectedRoutes } from '../src/core/route-policy.js';
import { createPlatformServer } from '../src/server.js';

async function seedItemOntology(ctx: ReturnType<typeof createMemoryPlatformContext>) {
  const o = await ctx.ontology.createOntology({ name: 'ing' });
  await ctx.ontology.addPropertyType(o.id, {
    id: 'pt.code',
    displayName: 'Code',
    baseType: 'string',
  });
  await ctx.ontology.addPropertyType(o.id, {
    id: 'pt.name',
    displayName: 'Name',
    baseType: 'string',
  });
  await ctx.ontology.addObjectType(o.id, {
    id: 'ot.item',
    displayName: 'Item',
    propertyTypeIds: ['pt.code', 'pt.name'],
  });
  const v1 = await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  const mapping = await ctx.mappingVersions.publish({
    mappingId: 'map-items',
    ontologyId: o.id,
    ontologyVersionId: v1.id,
    datasetId: 'ds',
    objectTypeId: 'ot.item',
    primaryKeyFields: ['id'],
    propertyMappings: [
      { sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' },
      { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' },
    ],
    createdBy: 'test',
  });
  return { ontologyId: o.id, mappingId: mapping.mappingId };
}

describe('PlatformContext.ingestion', () => {
  it('pulls envelopes through the wired runtime into objects', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'wired' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const ctx = createMemoryPlatformContext({
      policyFixture: 'allow-all',
      ingestionSources: [source],
    });
    const { ontologyId, mappingId } = await seedItemOntology(ctx);
    const run = await ctx.ingestion.startPull({
      connectorId: 'csv',
      mappingId,
      ontologyId,
      principal: 'svc',
    });
    const done = await ctx.ingestion.runOnce(run.id);
    expect(done.status).toBe('completed');
    expect((await ctx.objects.get(ontologyId, 'ot.item', '1'))?.properties['pt.name']).toBe(
      'wired',
    );
  });

  it('HTTP exposes the thin ingest webhook', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const { app } = await createPlatformServer(ctx);
    expect(
      listCollectedRoutes(app).some(
        (r) => r.method === 'POST' && r.url === '/api/v2/ingest/:connectorId',
      ),
    ).toBe(true);
    await app.close();
  });
});
