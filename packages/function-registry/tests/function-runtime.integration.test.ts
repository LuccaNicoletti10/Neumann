/**
 * function-registry — PostgreSQL Function artifacts/executions (ADR-0019).
 * Independent pools for restart and concurrent claim.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { AuthorizeResult } from 'contracts';
import {
  createDeterministicClock,
  createUuidIdGenerator,
  tryOpenIsolatedPg,
} from 'object-platform';
import { createOntologyRegistry } from 'ontology-registry';

import {
  FunctionArtifactHashMismatchError,
  artifactBytesFromSource,
  createFunctionDefinitionResolver,
  createFunctionRuntime,
  createFunctionWorker,
  createPgFunctionArtifactStore,
  createPgFunctionExecutionStore,
  hashArtifactBytes,
} from '../src/index.js';

const db = await tryOpenIsolatedPg();

const allow: AuthorizeResult = {
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: 'allow',
};

const ECHO = 'function(input, host) { return { v: 1 }; }';

describe.skipIf(!db)('FunctionRuntime PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('UPDATE/DELETE of artifacts fail; identical hash is reused; mismatched bytes fail closed', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const artifacts = createPgFunctionArtifactStore({ sql: db.sql, clock });
    const bytes = artifactBytesFromSource(ECHO);
    const published = await artifacts.publish(bytes, 'test');
    const again = await artifacts.publish(bytes, 'other');
    expect(again.artifactHash).toBe(published.artifactHash);
    expect(again.createdBy).toBe('test');
    await expect(
      db.sql.query(`UPDATE function_artifacts SET created_by = 'x' WHERE artifact_hash = $1`, [
        published.artifactHash,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.sql.query(`DELETE FROM function_artifacts WHERE artifact_hash = $1`, [
        published.artifactHash,
      ]),
    ).rejects.toThrow(/append-only/i);
    const fakeHash = '0'.repeat(64);
    await db.sql.query(
      `INSERT INTO function_artifacts (artifact_hash, bytes, byte_length, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [fakeHash, Buffer.from('not-the-hash'), Buffer.byteLength('not-the-hash'), clock(), 'tamper'],
    );
    await expect(artifacts.get(fakeHash)).rejects.toBeInstanceOf(FunctionArtifactHashMismatchError);
    expect(hashArtifactBytes(bytes)).toBe(published.artifactHash);
  });

  it('two workers concurrent claim: one winner; expired lease is resumed', async () => {
    if (!db) return;
    const a = db.reconnect();
    const b = db.reconnect();
    const clock = createDeterministicClock();
    const artifacts = createPgFunctionArtifactStore({ sql: db.sql, clock });
    const ontology = createOntologyRegistry();
    const published = await artifacts.publish(artifactBytesFromSource(ECHO), 'test');
    const o = await ontology.createOntology({ name: 'claim' });
    await ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: [],
      artifactHash: published.artifactHash,
      functionVersion: 1,
    });
    await ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    const storeA = createPgFunctionExecutionStore({ sql: a });
    const storeB = createPgFunctionExecutionStore({ sql: b });
    const runtime = createFunctionRuntime({
      artifacts,
      executions: storeA,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: () => allow,
      reads: {
        async currentSeq() {
          return 0;
        },
        async getObject() {
          return undefined;
        },
      },
      policyGeneration: () => 1,
      clock,
      nextId: createUuidIdGenerator(),
    });
    const created = await runtime.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
    });
    const [c1, c2] = await Promise.all([
      storeA.claimNext('w1', clock(), 15_000),
      storeB.claimNext('w2', clock(), 15_000),
    ]);
    const claimed = [c1, c2].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.executionId).toBe(created.executionId);
    const expired = new Date(Date.parse(clock()) + 60_000).toISOString();
    await db.sql.query(
      `UPDATE function_executions SET lease_expires_at = $2, status = 'RUNNING', lease_owner = 'w1'
       WHERE id = $1`,
      [created.executionId, '2000-01-01T00:00:00.000Z'],
    );
    const resumed = await storeB.claimNext('w2', expired, 15_000);
    expect(resumed?.executionId).toBe(created.executionId);
    expect(resumed?.leaseOwner).toBe('w2');
    void a;
    void b;
  });

  it('artifact and execution survive a new pool without reseed', async () => {
    if (!db) return;
    const firstSql = db.reconnect();
    const clock = createDeterministicClock();
    const artifacts = createPgFunctionArtifactStore({ sql: firstSql, clock });
    const executions = createPgFunctionExecutionStore({ sql: firstSql });
    const ontology = createOntologyRegistry();
    const published = await artifacts.publish(artifactBytesFromSource(ECHO), 'test');
    const o = await ontology.createOntology({ name: 'restart' });
    await ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: [],
      artifactHash: published.artifactHash,
      functionVersion: 1,
    });
    await ontology.commit({ ontologyId: o.id, createdBy: 'test' });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: () => allow,
      reads: {
        async currentSeq() {
          return 0;
        },
        async getObject() {
          return undefined;
        },
      },
      policyGeneration: () => 1,
      clock,
      nextId: createUuidIdGenerator(),
    });
    const created = await runtime.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
    });
    const pin = created.pin;
    const secondSql = db.reconnect();
    const replicaArtifacts = createPgFunctionArtifactStore({ sql: secondSql, clock });
    const replicaExecutions = createPgFunctionExecutionStore({ sql: secondSql });
    const replicaOntology = createOntologyRegistry();
    const replica = createFunctionRuntime({
      artifacts: replicaArtifacts,
      executions: replicaExecutions,
      resolver: createFunctionDefinitionResolver({ ontology: replicaOntology }),
      ontology: replicaOntology,
      authorize: () => allow,
      reads: {
        async currentSeq() {
          return 0;
        },
        async getObject() {
          return undefined;
        },
      },
      policyGeneration: () => 1,
      clock,
      nextId: createUuidIdGenerator(),
    });
    const loaded = await replica.get(created.executionId, 'alice');
    expect(loaded?.pin).toEqual(pin);
    const worker = createFunctionWorker({
      runtime: replica,
      executions: replicaExecutions,
      clock,
      workerId: 'replica',
    });
    expect(await worker.drainOnce()).toBe(1);
    const done = await replica.get(created.executionId, 'alice');
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.result).toEqual({ v: 1 });
    expect(done?.pin.artifactHash).toBe(published.artifactHash);
  });
});
