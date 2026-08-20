/**
 * platform-api — multi-replica Function readSeq (ADR-0021).
 * Frozen timestamp must not invert snapshots; seq is the frontier.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { artifactBytesFromSource } from 'function-registry';
import { tryOpenIsolatedPg } from 'object-platform';
import { ALLOW_ALL_POLICY_OVERLAY } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';

const db = await tryOpenIsolatedPg();
const ECHO =
  'function(input, host) { return { v: input.objects[0].properties.n }; }';
const FROZEN = '2026-08-20T12:00:00.000Z';

describe.skipIf(!db)('Function readSeq multi-replica', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('frozen clock + two pools: Function still sees v1 after update/delete', async () => {
    if (!db) return;
    const sql1 = db.reconnect();
    const ctx1 = await createPostgresPlatformContext({
      sql: sql1,
      transaction: sql1,
      policyFixture: 'allow-all',
      clock: () => FROZEN,
    });
    const published = await ctx1.functionArtifacts.publish(artifactBytesFromSource(ECHO), 'test');
    const o = await ctx1.ontology.createOntology({ name: 'fn-seq' });
    await ctx1.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
    await ctx1.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n'],
    });
    await ctx1.ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: ['ot.record'],
      artifactHash: published.artifactHash,
      functionVersion: 1,
    });
    await ctx1.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx1.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1 },
    });
    const created = await ctx1.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(created.readAsOf).toBe(FROZEN);
    expect(created.readSeq).toBeGreaterThan(0);
    expect(created.objectSnapshot[0]?.properties).toEqual({ n: 1 });

    const sql2 = db.reconnect();
    const ctx2 = await createPostgresPlatformContext({
      sql: sql2,
      transaction: sql2,
      overlay: ALLOW_ALL_POLICY_OVERLAY,
      clock: () => FROZEN,
    });
    await ctx2.objects.update(o.id, 'ot.record', 'A', {
      properties: { n: 2 },
      expectedVersion: 1,
    });
    await ctx2.objects.delete(o.id, 'ot.record', 'A', { expectedVersion: 2 });
    expect(await ctx2.objects.get(o.id, 'ot.record', 'A')).toBeUndefined();

    const done = await ctx2.functions.runOnce(created.executionId, 'w-seq');
    expect(done.status).toBe('SUCCEEDED');
    expect(done.result).toEqual({ v: 1 });
    expect(done.readSeq).toBe(created.readSeq);

    await ctx1.close?.();
    await sql1.close();
    await ctx2.close?.();
    await sql2.close();
  });
});
