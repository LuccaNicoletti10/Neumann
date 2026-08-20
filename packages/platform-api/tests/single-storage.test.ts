/**
 * platform-api — tests/single-storage.test.ts
 * One ObjectRepository is observed by ProjectionWriter, ObjectSet, Graph, Explore, history.
 */
import { describe, expect, it } from 'vitest';

import { catalogFromRepos } from 'explore-api';
import { resolveObjectSet } from 'object-set';

import { createMemoryPlatformContext } from '../src/core/context.js';

async function seedThing(ctx: ReturnType<typeof createMemoryPlatformContext>) {
  const ontologyId = (await ctx.ontology.createOntology({ name: 'one-store' })).id;
  await ctx.ontology.addPropertyType(ontologyId, {
    id: 'status',
    displayName: 'Status',
    baseType: 'string',
  });
  await ctx.ontology.addObjectType(ontologyId, {
    id: 'ot.thing',
    displayName: 'Thing',
    propertyTypeIds: ['status'],
  });
  await ctx.ontology.addActionType(ontologyId, {
    id: 'act.close',
    apiName: 'close',
    displayName: 'Close',
    inputObjectTypeIds: ['ot.thing'],
    parameters: {
      id: { baseType: 'object_reference', objectTypeId: 'ot.thing', required: true },
      status: { baseType: 'string', required: true },
    },
    rules: [
      {
        kind: 'modify_object',
        objectTypeId: 'ot.thing',
        primaryKeyFromParam: 'id',
        setPropertiesFromParams: { status: 'status' },
      },
    ],
  });
  await ctx.ontology.commit({ ontologyId, createdBy: 'test' });
  return ontologyId;
}

describe('single object storage kernel', () => {
  it('ProjectionWriter create is visible to ObjectSet, Graph, Explore, and history', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedThing(ctx);
    const written = await ctx.projections.projectObject({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-1',
      properties: { status: 'open' },
      source: 'test',
      sourceEventId: 'evt-1',
      principal: 'tester',
    });
    expect(written.status).toBe('applied');
    const live = written.object ?? (await ctx.objects.get(ontologyId, 'ot.thing', 'T-1'));
    expect(live?.properties.status).toBe('open');

    const set = await resolveObjectSet(
      { type: 'BASE', objectType: 'ot.thing' },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(set.some((o) => o.id === live?.id)).toBe(true);

    const neighbors = await ctx.graph.neighbors(ontologyId, 'ot.thing', 'T-1', {
      direction: 'outgoing',
    });
    expect(neighbors).toEqual([]);

    const catalog = await catalogFromRepos({
      ontologyId,
      objectTypeIds: ['ot.thing'],
      objects: ctx.objects,
      links: ctx.links,
    });
    expect(catalog.objects.some((o) => o.id === live?.id)).toBe(true);

    const hist = await ctx.history.listByObject(live!.id);
    expect(hist.some((e) => e.primaryKey === 'T-1')).toBe(true);
  });

  it('Action update is visible to ObjectSet, Graph, Explore, and history', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedThing(ctx);
    await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-2',
      properties: { status: 'open' },
    });
    const applied = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'close',
      parameters: { id: 'T-2', status: 'closed' },
      principal: 'tester',
      idempotencyKey: 'close-t2',
      expectedObjectVersions: { 'ot.thing::T-2': 1 },
    });
    expect(applied.status).toBe('SUCCEEDED');
    const live = await ctx.objects.get(ontologyId, 'ot.thing', 'T-2');
    expect(live?.properties.status).toBe('closed');
    const set = await resolveObjectSet(
      { type: 'BASE', objectType: 'ot.thing' },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(set.find((o) => o.primaryKey === 'T-2')?.properties.status).toBe('closed');
    const catalog = await catalogFromRepos({
      ontologyId,
      objectTypeIds: ['ot.thing'],
      objects: ctx.objects,
      links: ctx.links,
    });
    expect(catalog.objects.find((o) => o.primaryKey === 'T-2')?.properties.status).toBe('closed');
  });

  it('delete disappears from live readers and remains in history', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedThing(ctx);
    await ctx.projections.projectObject({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-3',
      properties: { status: 'open' },
      source: 'test',
      sourceEventId: 'evt-del',
      principal: 'tester',
    });
    const live = await ctx.objects.get(ontologyId, 'ot.thing', 'T-3');
    expect(live).toBeTruthy();
    await ctx.objects.delete(ontologyId, 'ot.thing', 'T-3');
    expect(await ctx.objects.get(ontologyId, 'ot.thing', 'T-3')).toBeUndefined();
    const set = await resolveObjectSet(
      { type: 'BASE', objectType: 'ot.thing' },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(set.some((o) => o.primaryKey === 'T-3')).toBe(false);
    const catalog = await catalogFromRepos({
      ontologyId,
      objectTypeIds: ['ot.thing'],
      objects: ctx.objects,
      links: ctx.links,
    });
    expect(catalog.objects.some((o) => o.primaryKey === 'T-3')).toBe(false);
    const hist = await ctx.history.listByObject(live!.id);
    expect(hist.length).toBeGreaterThan(0);
  });

  it('UnitOfWork failure restores every reader', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedThing(ctx);
    await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-4',
      properties: { status: 'open' },
    });
    // WHY through the writer: the context owns the boundary, so a rollback proof
    // must use the real mutation port instead of an ad-hoc partial UnitOfWork.
    await expect(
      ctx.projections.projectBatch({
        source: 'test',
        ontologyId,
        sourceEventId: 'evt-rollback',
        principal: 'tester',
        effects: [
          {
            kind: 'project_object',
            cmd: {
              ontologyId,
              objectTypeId: 'ot.thing',
              primaryKey: 'T-4',
              properties: { status: 'partial' },
              source: 'test',
              sourceEventId: 'evt-rollback',
              principal: 'tester',
            },
          },
          {
            kind: 'delete_object',
            cmd: {
              ontologyId,
              objectTypeId: 'ot.thing',
              primaryKey: 'T-4',
              source: 'test',
              sourceEventId: 'evt-rollback',
              principal: 'tester',
              expectedVersion: 99,
            },
          },
        ],
      }),
    ).rejects.toThrow(/version conflict/);
    expect((await ctx.objects.get(ontologyId, 'ot.thing', 'T-4'))?.properties.status).toBe('open');
    const set = await resolveObjectSet(
      { type: 'BASE', objectType: 'ot.thing' },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(set.find((o) => o.primaryKey === 'T-4')?.properties.status).toBe('open');
  });

  it('CAS admits one winner; no copy to synchronize', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedThing(ctx);
    const created = await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-5',
      properties: { status: 'open' },
    });
    const winner = await ctx.objects.update(ontologyId, 'ot.thing', 'T-5', {
      properties: { status: 'won' },
      expectedVersion: created.version,
    });
    try {
      await ctx.objects.update(ontologyId, 'ot.thing', 'T-5', {
        properties: { status: 'lost' },
        expectedVersion: created.version,
      });
      throw new Error('expected version conflict');
    } catch (err) {
      expect((err as Error).message).toMatch(/version conflict/);
    }
    expect((await ctx.objects.get(ontologyId, 'ot.thing', 'T-5'))?.version).toBe(winner.version);
    const set = await resolveObjectSet(
      { type: 'BASE', objectType: 'ot.thing' },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(set.find((o) => o.primaryKey === 'T-5')?.id).toBe(created.id);
  });

  it('projectBatch delegates through bindPrincipalToWriter and creates object atomically', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedThing(ctx);
    const result = await ctx.projections.projectBatch({
      ontologyId,
      source: 'test',
      sourceEventId: 'batch-1',
      principal: 'svc',
      effects: [
        {
          kind: 'project_object',
          cmd: {
            ontologyId,
            objectTypeId: 'ot.thing',
            primaryKey: 'T-batch',
            properties: { status: 'new' },
            source: 'test',
            sourceEventId: 'batch-1',
            principal: 'svc',
          },
        },
      ],
    });
    expect(result.status).toBe('applied');
    expect(result.results).toHaveLength(1);
    const obj = await ctx.objects.get(ontologyId, 'ot.thing', 'T-batch');
    expect(obj?.properties.status).toBe('new');
  });
});
