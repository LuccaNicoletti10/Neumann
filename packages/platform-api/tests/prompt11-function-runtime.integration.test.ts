/**
 * platform-api — PostgreSQL FunctionRuntime proofs (ADR-0019).
 * Independent pools for restart and concurrency. Does not reseed artifacts.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FunctionCrashFailpointError, artifactBytesFromSource } from 'function-registry';
import { createSystemClock, tryOpenIsolatedPg } from 'object-platform';
import {
  ALLOW_ALL_POLICY_OVERLAY,
  createDenyAllAuthorizer,
  createOntologyAuthorizer,
  type PolicyOverlay,
} from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';
import { signDevToken } from '../src/core/token-verifier.js';

const db = await tryOpenIsolatedPg();
const SECRET = 'test-hmac-secret-neumann';
const ECHO =
  'function(input, host) { return { v: input.objects[0].properties.n, keys: Object.keys(input.objects[0].properties).sort() }; }';
const HANG = 'function(input, host) { for (;;) {} }';
const ACT =
  'function(input, host) { return { result: { ok: true }, actions: [{ step: "s1", actionApiName: "setN", parameters: { id: "A", n: 2 }, expectedObjectVersions: { "ot.record::A": 1 } }] }; }';

const baseGrant = ALLOW_ALL_POLICY_OVERLAY.grants[0];
if (!baseGrant) throw new Error('ALLOW_ALL overlay missing grant');
const redactingOverlay: PolicyOverlay = {
  everyoneRole: 'world',
  roles: {},
  grants: [{ ...baseGrant, hiddenProperties: ['secret'] }],
};

function durableOpts(
  sql: ReturnType<NonNullable<typeof db>['reconnect']>,
  extra: Omit<
    Parameters<typeof createPostgresPlatformContext>[0],
    'sql' | 'transaction' | 'clock'
  > = {},
) {
  // WHY: asOf is created_at <= readAsOf. A restart context must not rewind
  // the clock behind existing history rows; the system clock is monotonic
  // per instance so create/update/delete in one context stay ordered.
  return {
    sql,
    transaction: sql,
    clock: createSystemClock(),
    ...extra,
  };
}

describe.skipIf(!db)('FunctionRuntime PostgreSQL platform', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('restart replica executes the old pin; redacted object; HTTP E2E', async () => {
    if (!db) return;
    const sql1 = db.reconnect();
    const ctx1 = await createPostgresPlatformContext(
      durableOpts(sql1, { policy: createOntologyAuthorizer(redactingOverlay) }),
    );
    const published = await ctx1.functionArtifacts.publish(artifactBytesFromSource(ECHO), 'test');
    const o = await ctx1.ontology.createOntology({ name: 'fn-pg' });
    await ctx1.ontology.addPropertyType(o.id, {
      id: 'n',
      displayName: 'N',
      baseType: 'number',
    });
    await ctx1.ontology.addPropertyType(o.id, {
      id: 'secret',
      displayName: 'Secret',
      baseType: 'string',
    });
    await ctx1.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n', 'secret'],
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
      properties: { n: 1, secret: 'nope' },
    });
    const created = await ctx1.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(created.objectSnapshot[0]?.properties).toEqual({ n: 1 });
    const pin = created.pin;
    await ctx1.close?.();
    await sql1.close();

    const sql2 = db.reconnect();
    const ctx2 = await createPostgresPlatformContext(
      durableOpts(sql2, { policy: createOntologyAuthorizer(redactingOverlay) }),
    );
    const loaded = await ctx2.functions.get(created.executionId, 'alice');
    expect(loaded?.pin).toEqual(pin);
    const done = await ctx2.functions.runOnce(created.executionId, 'w-restart');
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.result).toEqual({ v: 1, keys: ['n'] });

    const { app } = await createPlatformServer(ctx2, { jwtSecret: SECRET });
    const token = signDevToken({ secret: SECRET, principal: 'alice' });
    const headers = { authorization: `Bearer ${token}` };
    const httpCreate = await app.inject({
      method: 'POST',
      url: `/api/v2/ontologies/${o.id}/functions/echo/execute`,
      headers,
      payload: { refs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }] },
    });
    expect(httpCreate.statusCode).toBe(202);
    await ctx2.functions.runOnce(httpCreate.json().executionId, 'w-http');
    const httpGot = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${o.id}/function-executions/${httpCreate.json().executionId}`,
      headers,
    });
    expect(httpGot.statusCode).toBe(200);
    expect(httpGot.json().status).toBe('SUCCEEDED');
    expect(httpGot.json().result.keys).toEqual(['n']);
    await app.close();
    await ctx2.close?.();
    await sql2.close();
  });

  it('two workers one claim; concurrent cancel is terminal; principals isolate', async () => {
    if (!db) return;
    const sql = db.reconnect();
    const ctx = await createPostgresPlatformContext(
      durableOpts(sql, { policyFixture: 'allow-all' }),
    );
    const published = await ctx.functionArtifacts.publish(artifactBytesFromSource(ECHO), 'test');
    const o = await ctx.ontology.createOntology({ name: 'fn-cas' });
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
      artifactHash: published.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1 },
    });
    const pending = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    const [r1, r2] = await Promise.allSettled([
      ctx.functions.runOnce(pending.executionId, 'w1'),
      ctx.functions.runOnce(pending.executionId, 'w2'),
    ]);
    expect([r1, r2].filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const terminal = await ctx.functions.get(pending.executionId, 'alice');
    expect(terminal?.status).toBe('SUCCEEDED');

    const toCancel = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    const [c1, c2] = await Promise.all([
      ctx.functions.cancel(toCancel.executionId, 'alice'),
      ctx.functions.cancel(toCancel.executionId, 'alice'),
    ]);
    expect(c1.status).toBe('CANCELLED');
    expect(c2.status).toBe('CANCELLED');

    const a = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      parameters: { n: 1 },
      idempotencyKey: 'same',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    const b = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'bob',
      parameters: { n: 1 },
      idempotencyKey: 'same',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(a.executionId).not.toBe(b.executionId);
    expect(await ctx.functions.get(a.executionId, 'bob')).toBeUndefined();
    await ctx.close?.();
    await sql.close();
  });

  it('policy revoked before claim is DENIED and does not TIMEOUT', async () => {
    if (!db) return;
    const sql1 = db.reconnect();
    const ctx1 = await createPostgresPlatformContext(
      durableOpts(sql1, { policyFixture: 'allow-all' }),
    );
    const hang = await ctx1.functionArtifacts.publish(artifactBytesFromSource(HANG), 'test');
    const o = await ctx1.ontology.createOntology({ name: 'fn-deny' });
    await ctx1.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
    await ctx1.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n'],
    });
    await ctx1.ontology.addFunctionType(o.id, {
      id: 'fn.hang',
      apiName: 'hang',
      displayName: 'hang',
      inputObjectTypeIds: ['ot.record'],
      artifactHash: hang.artifactHash,
      functionVersion: 1,
    });
    await ctx1.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx1.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1 },
    });
    const hanging = await ctx1.functions.create({
      ontologyId: o.id,
      functionId: 'hang',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(hanging.status).toBe('PENDING');
    await ctx1.close?.();
    await sql1.close();

    const sql2 = db.reconnect();
    const ctx2 = await createPostgresPlatformContext(
      durableOpts(sql2, { policy: createDenyAllAuthorizer() }),
    );
    const denied = await ctx2.functions.runOnce(hanging.executionId, 'w-deny');
    expect(denied.status).toBe('DENIED');
    expect(denied.error?.code).toBe('DENIED');
    await ctx2.close?.();
    await sql2.close();
  });

  it('crash after Action before Function result does not duplicate the mutation', async () => {
    if (!db) return;
    let crash = true;
    const sql = db.reconnect();
    const ctx = await createPostgresPlatformContext(
      durableOpts(sql, {
        policyFixture: 'allow-all',
        afterActionBeforeResult: async () => {
          if (crash) {
            crash = false;
            throw new FunctionCrashFailpointError();
          }
        },
      }),
    );
    const act = await ctx.functionArtifacts.publish(artifactBytesFromSource(ACT), 'test');
    const o = await ctx.ontology.createOntology({ name: 'fn-act' });
    await ctx.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
    await ctx.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n'],
    });
    await ctx.ontology.addActionType(o.id, {
      id: 'act.setN',
      apiName: 'setN',
      displayName: 'setN',
      inputObjectTypeIds: ['ot.record'],
      parameters: {
        id: { baseType: 'string', required: true },
        n: { baseType: 'number', required: true },
      },
      rules: [
        {
          kind: 'modify_object',
          objectTypeId: 'ot.record',
          primaryKeyFromParam: 'id',
          setPropertiesFromParams: { n: 'n' },
        },
      ],
    });
    await ctx.ontology.addFunctionType(o.id, {
      id: 'fn.act',
      apiName: 'act',
      displayName: 'act',
      inputObjectTypeIds: ['ot.record'],
      artifactHash: act.artifactHash,
      functionVersion: 1,
    });
    await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    await ctx.policyAdmin!.publishOverlay(ALLOW_ALL_POLICY_OVERLAY);
    await ctx.objects.create({
      ontologyId: o.id,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1 },
    });
    const acting = await ctx.functions.create({
      ontologyId: o.id,
      functionId: 'act',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    await expect(ctx.functions.runOnce(acting.executionId, 'w-act')).rejects.toBeInstanceOf(
      FunctionCrashFailpointError,
    );
    expect((await ctx.objects.get(o.id, 'ot.record', 'A'))?.properties.n).toBe(2);
    const again = await ctx.functions.runOnce(acting.executionId, 'w-act');
    expect(again.status).toBe('SUCCEEDED');
    expect((await ctx.objects.get(o.id, 'ot.record', 'A'))?.properties.n).toBe(2);
    await ctx.close?.();
    await sql.close();
  });

  it('v1 snapshot survives update, delete, and restart with a new pool', async () => {
    if (!db) return;
    const sql1 = db.reconnect();
    const ctx1 = await createPostgresPlatformContext(
      durableOpts(sql1, { policy: createOntologyAuthorizer(redactingOverlay) }),
    );
    const published = await ctx1.functionArtifacts.publish(artifactBytesFromSource(ECHO), 'test');
    const o = await ctx1.ontology.createOntology({ name: 'fn-asof' });
    await ctx1.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
    await ctx1.ontology.addPropertyType(o.id, {
      id: 'secret',
      displayName: 'Secret',
      baseType: 'string',
    });
    await ctx1.ontology.addObjectType(o.id, {
      id: 'ot.record',
      displayName: 'Record',
      propertyTypeIds: ['n', 'secret'],
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
      properties: { n: 1, secret: 'nope' },
    });
    const created = await ctx1.functions.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(created.objectSnapshot[0]?.properties).toEqual({ n: 1 });
    expect(created.readAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await ctx1.objects.update(o.id, 'ot.record', 'A', {
      properties: { n: 2 },
      expectedVersion: 1,
    });
    await ctx1.objects.delete(o.id, 'ot.record', 'A', { expectedVersion: 2 });
    expect(await ctx1.objects.get(o.id, 'ot.record', 'A')).toBeUndefined();
    await ctx1.close?.();
    await sql1.close();

    const sql2 = db.reconnect();
    const ctx2 = await createPostgresPlatformContext(
      durableOpts(sql2, { policy: createOntologyAuthorizer(redactingOverlay) }),
    );
    expect(await ctx2.objects.get(o.id, 'ot.record', 'A')).toBeUndefined();
    const done = await ctx2.functions.runOnce(created.executionId, 'w-asof');
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.result).toEqual({ v: 1, keys: ['n'] });
    expect(done?.readAsOf).toBe(created.readAsOf);
    await ctx2.close?.();
    await sql2.close();
  });
});
