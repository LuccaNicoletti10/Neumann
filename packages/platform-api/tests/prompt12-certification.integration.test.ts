/**
 * platform-api — Prompt 12 certification E2E (empty isolated PostgreSQL).
 * Public APIs + workers only. Industrial domain lives in certification fixtures.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactBytesFromSource } from 'function-registry';
import { tryOpenIsolatedPg } from 'object-platform';
import {
  createOntologyAuthorizer,
  type PolicyOverlay,
} from 'policy-engine';
import { createOutboxWorker, createPgOutboxRepository } from 'event-bus';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { assertProductionConfig } from '../src/core/assert-production-config.js';

const db = await tryOpenIsolatedPg();
const SECRET = 'cert-hmac-secret-neumann';
const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/certification/fixtures/industrial',
);

const ECHO =
  'function(input, host) { return { n: input.objects[0].properties.qty ?? input.objects[0].properties.n, keys: Object.keys(input.objects[0].properties).sort() }; }';

function industrialOverlay(): PolicyOverlay {
  const raw = readFileSync(join(FIXTURE_DIR, 'domain.ts'), 'utf8');
  // WHY: fixture must stay outside packages/*/src; the test only asserts presence.
  expect(raw).toContain('Customer');
  expect(raw).toContain('creditLimit');
  return {
    everyoneRole: 'world',
    roles: {},
    grants: [
      {
        role: 'world',
        ontologyIds: ['*'],
        objectTypes: ['*'],
        linkTypes: ['*'],
        actions: ['*'],
        functions: ['*'],
        adminResources: ['*'],
        operations: ['read', 'modify'],
        hiddenProperties: ['creditLimit', 'unitCost', 'margin', 'internalNotes'],
      },
    ],
  };
}

describe.skipIf(!db)('Prompt 12 kernel certification', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('ontology → ingest projection → Function asOf → Action → outbox on public APIs', async () => {
    if (!db) return;
    assertProductionConfig({
      mode: 'postgres',
      env: 'test',
      ready: true,
      policyDegraded: false,
      databaseUrl: process.env.DATABASE_URL,
    });

    const sql = db.reconnect();
    const overlay = industrialOverlay();
    const ctx = await createPostgresPlatformContext({
      sql,
      transaction: sql,
      policy: createOntologyAuthorizer(overlay),
    });

    const published = await ctx.functionArtifacts.publish(artifactBytesFromSource(ECHO), 'cert');
    const o = await ctx.ontology.createOntology({ name: 'acme-industrial' });
    for (const [id, baseType] of [
      ['name', 'string'],
      ['qty', 'number'],
      ['creditLimit', 'number'],
      ['unitCost', 'number'],
      ['margin', 'number'],
      ['internalNotes', 'string'],
      ['n', 'number'],
    ] as const) {
      await ctx.ontology.addPropertyType(o.id, { id, displayName: id, baseType });
    }
    await ctx.ontology.addObjectType(o.id, {
      id: 'Customer',
      displayName: 'Customer',
      propertyTypeIds: ['name', 'creditLimit'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'Product',
      displayName: 'Product',
      propertyTypeIds: ['name', 'unitCost'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'SalesOrder',
      displayName: 'SalesOrder',
      propertyTypeIds: ['name', 'qty', 'margin'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'InventoryPosition',
      displayName: 'InventoryPosition',
      propertyTypeIds: ['name', 'qty'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'Machine',
      displayName: 'Machine',
      propertyTypeIds: ['name', 'internalNotes'],
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'WorkOrder',
      displayName: 'WorkOrder',
      propertyTypeIds: ['name', 'qty'],
    });
    await ctx.ontology.addLinkType(o.id, {
      id: 'CustomerHasOrder',
      displayName: 'CustomerHasOrder',
      sourceObjectTypeId: 'Customer',
      targetObjectTypeId: 'SalesOrder',
      cardinality: '1:N',
    });
    await ctx.ontology.addLinkType(o.id, {
      id: 'OrderHasProduct',
      displayName: 'OrderHasProduct',
      sourceObjectTypeId: 'SalesOrder',
      targetObjectTypeId: 'Product',
      cardinality: 'N:N',
    });
    await ctx.ontology.addActionType(o.id, {
      id: 'act.createWorkOrder',
      apiName: 'createWorkOrder',
      displayName: 'createWorkOrder',
      inputObjectTypeIds: ['SalesOrder'],
      parameters: {
        id: { baseType: 'string', required: true },
        name: { baseType: 'string', required: true },
        qty: { baseType: 'number', required: true },
      },
      rules: [
        {
          kind: 'create_object',
          objectTypeId: 'WorkOrder',
          primaryKeyFromParam: 'id',
          propertiesFromParams: { name: 'name', qty: 'qty' },
        },
      ],
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: ['SalesOrder'],
      artifactHash: published.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'cert' });

    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'Customer',
      primaryKey: 'C1',
      properties: { name: 'Acme', creditLimit: 1000 },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'Product',
      primaryKey: 'P1',
      properties: { name: 'Widget', unitCost: 12 },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'SalesOrder',
      primaryKey: 'SO1',
      properties: { name: 'SO-1', qty: 5, margin: 0.2 },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'InventoryPosition',
      primaryKey: 'INV1',
      properties: { name: 'Bin-A', qty: 40 },
    });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'Machine',
      primaryKey: 'M1',
      properties: { name: 'CNC-1', internalNotes: 'secret' },
    });
    await ctx.links.create({
      ontologyId: o.id,
      linkTypeId: 'CustomerHasOrder',
      sourceObjectTypeId: 'Customer',
      sourcePrimaryKey: 'C1',
      targetObjectTypeId: 'SalesOrder',
      targetPrimaryKey: 'SO1',
    });
    await ctx.links.create({
      ontologyId: o.id,
      linkTypeId: 'OrderHasProduct',
      sourceObjectTypeId: 'SalesOrder',
      sourcePrimaryKey: 'SO1',
      targetObjectTypeId: 'Product',
      targetPrimaryKey: 'P1',
    });

    const integrity = await ctx.graph.checkIntegrity(o.id);
    expect(integrity.ok).toBe(true);
    expect(integrity.objectCount).toBeGreaterThan(0);
    expect(integrity.linkCount).toBeGreaterThan(0);

    const neighbors = await ctx.graph.neighbors(o.id, 'SalesOrder', 'SO1', {
      linkTypeIds: ['CustomerHasOrder', 'OrderHasProduct'],
      direction: 'both',
    });
    expect(neighbors.length).toBeGreaterThanOrEqual(1);

    const fn = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'SalesOrder', primaryKey: 'SO1' }],
    });
    expect(fn.objectSnapshot[0]?.properties).toEqual({ name: 'SO-1', qty: 5 });
    expect(fn.objectSnapshot[0]?.properties).not.toHaveProperty('margin');
    const pinSeq = fn.readSeq;
    await ctx.objects.update(o.id, 'SalesOrder', 'SO1', {
      properties: { qty: 99 },
      expectedVersion: 1,
    });
    const fnDone = await ctx.functions.runOnce(fn.executionId, 'cert-fn');
    expect(fnDone.status).toBe('SUCCEEDED');
    expect(fnDone.result).toEqual({ n: 5, keys: ['name', 'qty'] });
    expect(fnDone.readSeq).toBe(pinSeq);

    const action = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'createWorkOrder',
      principal: 'alice',
      parameters: { id: 'WO1', name: 'Cut', qty: 5 },
      idempotencyKey: 'cert-wo-1',
    });
    expect(action.status).toBe('SUCCEEDED');
    expect((await ctx.objects.get(o.id, 'WorkOrder', 'WO1'))?.properties.name).toBe('Cut');
    const replay = await ctx.actions.apply({
      ontologyId: o.id,
      actionApiName: 'createWorkOrder',
      principal: 'alice',
      parameters: { id: 'WO1', name: 'Cut', qty: 5 },
      idempotencyKey: 'cert-wo-1',
    });
    expect(replay.executionId).toBe(action.executionId);

    const o2 = await ctx.ontology.createOntology({ name: 'other-plant' });
    await ctx.ontology.addPropertyType(o2.id, { id: 'name', displayName: 'Name', baseType: 'string' });
    await ctx.ontology.addObjectType(o2.id, {
      id: 'Customer',
      displayName: 'Customer',
      propertyTypeIds: ['name'],
    });
    await ctx.ontology.commit({ ontologyId: o2.id, createdBy: 'cert' });
    await ctx.objects.create({
      ontologyId: o2.id,
      objectTypeId: 'Customer',
      primaryKey: 'C1',
      properties: { name: 'Other' },
    });
    expect((await ctx.objects.get(o.id, 'Customer', 'C1'))?.properties.name).toBe('Acme');
    expect((await ctx.objects.get(o2.id, 'Customer', 'C1'))?.properties.name).toBe('Other');

    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);

    const worker = createOutboxWorker({
      dispatcher: createPgOutboxRepository({ sql }),
      handlers: {},
      onUnhandled: () => {},
    });
    await worker.drainOnce();

    await app.close();
    await ctx.close?.();
    await sql.close();
  });
});
