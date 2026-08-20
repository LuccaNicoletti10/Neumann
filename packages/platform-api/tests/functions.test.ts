/**
 * platform-api — FunctionRuntime HTTP adapter (ADR-0019).
 */
import { describe, expect, it } from 'vitest';

import {
  AGGREGATE_METRICS_SOURCE,
  SCORE_RECORD_SOURCE,
  artifactBytesFromSource,
} from 'function-registry';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const SECRET = 'test-hmac-secret-neumann';

describe('FunctionRuntime HTTP', () => {
  it('POST execute is 202; worker + GET return the pinned result', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const score = await ctx.functionArtifacts.publish(
      artifactBytesFromSource(SCORE_RECORD_SOURCE),
      'test',
    );
    const agg = await ctx.functionArtifacts.publish(
      artifactBytesFromSource(AGGREGATE_METRICS_SOURCE),
      'test',
    );
    const o = await ctx.ontology.createOntology({ name: 'fn' });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'name',
      displayName: 'Name',
      baseType: 'string',
    });
    await ctx.ontology.addPropertyType(o.id, {
      id: 'amount',
      displayName: 'Amount',
      baseType: 'number',
    });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.customer',
      displayName: 'Customer',
      propertyTypeIds: ['name', 'amount'],
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.scoreRecord',
      displayName: 'scoreRecord',
      apiName: 'scoreRecord',
      inputObjectTypeIds: ['ot.customer'],
      artifactHash: score.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.aggregateMetrics',
      displayName: 'aggregateMetrics',
      apiName: 'aggregateMetrics',
      inputObjectTypeIds: ['ot.customer'],
      artifactHash: agg.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.customer',
      primaryKey: 'A',
      properties: { name: 'ACME', amount: 80 },
    });

    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });
    const token = signDevToken({ secret: SECRET, principal: 'svc-projector' });
    const headers = { authorization: `Bearer ${token}` };

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/functions`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((d: { apiName: string }) => d.apiName === 'scoreRecord')).toBe(
      true,
    );

    const exec = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/scoreRecord/execute`,
      headers,
      payload: {
        refs: [{ objectTypeId: 'ot.customer', primaryKey: 'A' }],
      },
    });
    expect(exec.statusCode).toBe(202);
    expect(exec.json().status).toBe('PENDING');
    expect(exec.json().pin.artifactHash).toBe(score.artifactHash);

    expect(await ctx.functionWorker.drainOnce()).toBe(1);

    const got = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/function-executions/${exec.json().executionId}`,
      headers,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().status).toBe('SUCCEEDED');
    expect(got.json().result.scores[0].score).toBeGreaterThan(0);

    const viaRef = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/aggregateMetrics/execute`,
      headers,
      payload: {
        refs: [{ objectTypeId: 'ot.customer', primaryKey: 'A' }],
        params: { property: 'amount' },
      },
    });
    expect(viaRef.statusCode).toBe(202);
    expect(await ctx.functionWorker.drainOnce()).toBe(1);
    const aggGot = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/function-executions/${viaRef.json().executionId}`,
      headers,
    });
    expect(aggGot.json().result.sum).toBe(80);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/functions/no-such-fn`,
      headers,
    });
    expect(missing.statusCode).toBe(404);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/scoreRecord/execute`,
      headers,
      payload: { refs: [{ objectTypeId: 'ot.customer', primaryKey: 'A' }] },
    });
    expect(cancel.statusCode).toBe(202);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/function-executions/${cancel.json().executionId}/cancel`,
      headers,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('CANCELLED');

    const other = signDevToken({ secret: SECRET, principal: 'other' });
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/function-executions/${exec.json().executionId}`,
      headers: { authorization: `Bearer ${other}` },
    });
    expect(hidden.statusCode).toBe(404);

    await app.close();
  });

  it('asOf snapshot is unchanged after later update and delete', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const echo = await ctx.functionArtifacts.publish(
      artifactBytesFromSource(
        'function(input, host) { return { v: input.objects[0].properties.n }; }',
      ),
      'test',
    );
    const o = await ctx.ontology.createOntology({ name: 'fn-asof' });
    await ctx.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n'],
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: ['ot.record'],
      artifactHash: echo.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1 },
    });
    const created = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(created.objectSnapshot[0]?.properties).toEqual({ n: 1 });
    await ctx.objects.update(o.id, 'ot.record', 'A', { properties: { n: 2 }, expectedVersion: 1 });
    await ctx.objects.delete(o.id, 'ot.record', 'A', { expectedVersion: 2 });
    expect(await ctx.objects.get(o.id, 'ot.record', 'A')).toBeUndefined();
    expect(await ctx.functionWorker.drainOnce()).toBe(1);
    const done = await ctx.functions.get(created.executionId, 'alice');
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.result).toEqual({ v: 1 });
  });

  it('missing snapshot is FUNCTION_SNAPSHOT_UNAVAILABLE and does not execute', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const echo = await ctx.functionArtifacts.publish(
      artifactBytesFromSource('function(input, host) { return { v: 1 }; }'),
      'test',
    );
    const o = await ctx.ontology.createOntology({ name: 'fn-miss' });
    await ctx.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n'],
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: [],
      artifactHash: echo.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    const { app } = await createPlatformServer(ctx, { jwtSecret: SECRET });
    const token = signDevToken({ secret: SECRET, principal: 'alice' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/echo/execute`,
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ objectTypeId: 'ot.record', primaryKey: 'NOPE' }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().errorName).toBe('FUNCTION_SNAPSHOT_UNAVAILABLE');
    await app.close();
  });
});
