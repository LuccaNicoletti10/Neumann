/**
 * function-registry — FunctionRuntime unit proofs (ADR-0019).
 */
import { describe, expect, it } from 'vitest';

import type {
  ActionApplyRequest,
  ActionApplyResult,
  AuthorizeFn,
  AuthorizeResult,
  FunctionArtifactStore,
} from 'contracts';
import { createDeterministicClock, createIdGenerator } from 'object-platform';
import { createOntologyRegistry } from 'ontology-registry';

import {
  FunctionCrashFailpointError,
  FunctionDeniedError,
  FunctionIdempotencyConflictError,
  FunctionInvalidParametersError,
  FunctionPublishError,
  FunctionSnapshotUnavailableError,
  SCORE_RECORD_SOURCE,
  artifactBytesFromSource,
  assertPublishableArtifact,
  classifyFunctionSandboxFailure,
  createFunctionDefinitionResolver,
  createFunctionRuntime,
  createFunctionWorker,
  createMemoryFunctionArtifactStore,
  createMemoryFunctionExecutionStore,
  derivedActionIdempotencyKey,
  hashArtifactBytes,
  runFunctionArtifact,
  type FunctionObjectReader,
} from '../src/index.js';

const allow: AuthorizeResult = {
  decision: 'allow',
  principalEpids: [],
  resourceEpid: null,
  reason: 'allow',
};

function decisionOf(d: AuthorizeResult['decision']): AuthorizeFn {
  return () => ({ ...allow, decision: d, reason: d });
}

const reads: FunctionObjectReader = {
  async currentSeq() {
    return 1;
  },
  async getObject(_principal, _ontologyId, objectTypeId, primaryKey) {
    return {
      objectTypeId,
      primaryKey,
      properties: { n: 1 },
    };
  },
};

function countingGets(inner: FunctionArtifactStore): {
  store: FunctionArtifactStore;
  gets: () => number;
} {
  let gets = 0;
  return {
    gets: () => gets,
    store: {
      publish: (bytes, createdBy) => inner.publish(bytes, createdBy),
      get: async (hash) => {
        gets += 1;
        return inner.get(hash);
      },
    },
  };
}

async function seedFunction(opts: {
  artifacts: FunctionArtifactStore;
  ontology: ReturnType<typeof createOntologyRegistry>;
  source?: string;
  functionId?: string;
  functionVersion?: number;
  inputSchema?: Record<string, unknown>;
}): Promise<{ ontologyId: string; artifactHash: string; versionId: string }> {
  const source = opts.source ?? 'function(input, host) { return { v: 1 }; }';
  const published = await opts.artifacts.publish(artifactBytesFromSource(source), 'test');
  const o = await opts.ontology.createOntology({ name: 'fn' });
  await opts.ontology.addFunctionType(o.id, {
    id: opts.functionId ?? 'fn.echo',
    apiName: 'echo',
    displayName: 'echo',
    inputObjectTypeIds: [],
    artifactHash: published.artifactHash,
    functionVersion: opts.functionVersion ?? 1,
    inputSchema: opts.inputSchema,
  });
  const version = await opts.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  return { ontologyId: o.id, artifactHash: published.artifactHash, versionId: version.id };
}

describe('Function artifacts', () => {
  it('hash is deterministic; identical bytes are reused; mutated bytes differ', async () => {
    const artifacts = createMemoryFunctionArtifactStore({ clock: createDeterministicClock() });
    const bytes = artifactBytesFromSource(SCORE_RECORD_SOURCE);
    expect(hashArtifactBytes(bytes)).toBe(hashArtifactBytes(bytes));
    const a = await artifacts.publish(bytes, 'a');
    const b = await artifacts.publish(bytes, 'b');
    expect(b.artifactHash).toBe(a.artifactHash);
    expect(b.createdBy).toBe('a');
    const other = artifactBytesFromSource(`${SCORE_RECORD_SOURCE}\n`);
    expect(hashArtifactBytes(other)).not.toBe(a.artifactHash);
    const c = await artifacts.publish(other, 'c');
    expect(c.artifactHash).not.toBe(a.artifactHash);
  });

  it('forbidden APIs are rejected at publish and FORBIDDEN_API at execute', async () => {
    expect(() => assertPublishableArtifact("function(input, host) { require('fs'); }")).toThrow(
      FunctionPublishError,
    );
    const artifacts = createMemoryFunctionArtifactStore({ clock: createDeterministicClock() });
    await expect(
      artifacts.publish(artifactBytesFromSource("function(input, host) { eval('1'); }"), 't'),
    ).rejects.toBeInstanceOf(FunctionPublishError);
    const sandboxed = await runFunctionArtifact({
      bytes: artifactBytesFromSource("function(input, host) { require('fs'); return 1; }"),
      objects: [],
      parameters: {},
      clock: '2024-01-01T00:00:00.000Z',
      executionId: 'e1',
      limits: { timeoutMs: 1_000, maxOutputBytes: 1_000, maxMemoryMb: 32, maxLogBytes: 1_000 },
    });
    expect(sandboxed.ok).toBe(false);
    expect(sandboxed.code).toBe('FORBIDDEN_API');
  });
});

describe('FunctionRuntime', () => {
  it('pin survives a newer FunctionType publish', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const first = await artifacts.publish(artifactBytesFromSource('function(input, host) { return { v: 1 }; }'), 't');
    const second = await artifacts.publish(artifactBytesFromSource('function(input, host) { return { v: 2 }; }'), 't');
    const o = await ontology.createOntology({ name: 'pin' });
    await ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: [],
      artifactHash: first.artifactHash,
      functionVersion: 1,
    });
    const v1 = await ontology.commit({ ontologyId: o.id, createdBy: 't' });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads,
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    const created = await runtime.create({
      ontologyId: o.id,
      functionId: 'echo',
      principal: 'alice',
      ontologyVersionId: v1.id,
    });
    await ontology.openDraft(o.id);
    await ontology.addFunctionType(o.id, {
      id: 'fn.echo',
      apiName: 'echo',
      displayName: 'echo',
      inputObjectTypeIds: [],
      artifactHash: second.artifactHash,
      functionVersion: 2,
    });
    await ontology.commit({ ontologyId: o.id, createdBy: 't' });
    const ran = await runtime.runOnce(created.executionId, 'w1');
    expect(ran.pin.artifactHash).toBe(first.artifactHash);
    expect(ran.pin.ontologyVersionId).toBe(v1.id);
    expect(ran.result).toEqual({ v: 1 });
  });

  it('partial and deny never start the sandbox', async () => {
    const clock = createDeterministicClock();
    const inner = createMemoryFunctionArtifactStore({ clock });
    const counted = countingGets(inner);
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({ artifacts: counted.store, ontology });
    for (const decision of ['partial', 'deny'] as const) {
      const runtime = createFunctionRuntime({
        artifacts: counted.store,
        executions,
        resolver: createFunctionDefinitionResolver({ ontology }),
        ontology,
        authorize: decisionOf(decision),
        reads,
        policyGeneration: () => 1,
        clock,
        nextId: createIdGenerator(),
      });
      await expect(
        runtime.create({ ontologyId: seeded.ontologyId, functionId: 'echo', principal: 'alice' }),
      ).rejects.toBeInstanceOf(FunctionDeniedError);
    }
    expect(counted.gets()).toBe(0);
  });

  it('redaction happens before the sandbox sees properties', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const redacting: FunctionObjectReader = {
      async currentSeq() {
        return 1;
      },
      async getObject(_p, _o, objectTypeId, primaryKey) {
        return {
          objectTypeId,
          primaryKey,
          properties: { n: 1 },
        };
      },
    };
    const seeded = await seedFunction({
      artifacts,
      ontology,
      source: 'function(input, host) { return Object.keys(input.objects[0].properties).sort(); }',
    });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads: redacting,
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    const created = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    expect(created.objectSnapshot[0]?.properties).toEqual({ n: 1 });
    expect(created.objectSnapshot[0]?.properties).not.toHaveProperty('secret');
    const ran = await runtime.runOnce(created.executionId, 'w1');
    expect(ran.result).toEqual(['n']);
  });

  it('invalid parameters do not create an execution', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({
      artifacts,
      ontology,
      inputSchema: { required: ['n'] },
    });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads,
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    await expect(
      runtime.create({ ontologyId: seeded.ontologyId, functionId: 'echo', principal: 'alice' }),
    ).rejects.toBeInstanceOf(FunctionInvalidParametersError);
  });

  it('undefined output is INVALID_OUTPUT, not success', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({
      artifacts,
      ontology,
      source: 'function(input, host) { }',
    });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads,
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    const created = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
    });
    const ran = await runtime.runOnce(created.executionId, 'w1');
    expect(ran.status).toBe('FAILED');
    expect(ran.error?.code).toBe('INVALID_OUTPUT');
  });

  it('timeout is not MEMORY_LIMIT; generic throw is EXECUTION_ERROR', async () => {
    expect(classifyFunctionSandboxFailure('TIMEOUT')).toBe('TIMEOUT');
    expect(classifyFunctionSandboxFailure('MEMORY_LIMIT')).toBe('MEMORY_LIMIT');
    expect(classifyFunctionSandboxFailure('TIMEOUT')).not.toBe('MEMORY_LIMIT');
    expect(classifyFunctionSandboxFailure(undefined, 'boom')).toBe('EXECUTION_ERROR');
    const timed = await runFunctionArtifact({
      bytes: artifactBytesFromSource('function(input, host) { for (;;) {} }'),
      objects: [],
      parameters: {},
      clock: '2024-01-01T00:00:00.000Z',
      executionId: 'e-timeout',
      limits: { timeoutMs: 200, maxOutputBytes: 1_000, maxMemoryMb: 32, maxLogBytes: 1_000 },
    });
    expect(timed.ok).toBe(false);
    expect(timed.code).toBe('TIMEOUT');
    const boom = await runFunctionArtifact({
      bytes: artifactBytesFromSource('function(input, host) { throw new Error("boom-unrelated"); }'),
      objects: [],
      parameters: {},
      clock: '2024-01-01T00:00:00.000Z',
      executionId: 'e-err',
      limits: { timeoutMs: 1_000, maxOutputBytes: 1_000, maxMemoryMb: 32, maxLogBytes: 1_000 },
    });
    expect(boom.ok).toBe(false);
    expect(boom.code).toBe('EXECUTION_ERROR');
  });

  it('output and log size are limited', async () => {
    const huge = await runFunctionArtifact({
      bytes: artifactBytesFromSource('function(input, host) { return { s: Array(400).join("x") }; }'),
      objects: [],
      parameters: {},
      clock: '2024-01-01T00:00:00.000Z',
      executionId: 'e-out',
      limits: { timeoutMs: 1_000, maxOutputBytes: 40, maxMemoryMb: 32, maxLogBytes: 4_000 },
    });
    expect(huge.ok).toBe(false);
    expect(huge.code).toBe('OUTPUT_LIMIT');
    const logs = await runFunctionArtifact({
      bytes: artifactBytesFromSource(
        'function(input, host) { host.log(Array(80).join("z")); return 1; }',
      ),
      objects: [],
      parameters: {},
      clock: '2024-01-01T00:00:00.000Z',
      executionId: 'e-log',
      limits: { timeoutMs: 1_000, maxOutputBytes: 4_000, maxMemoryMb: 32, maxLogBytes: 20 },
    });
    expect(logs.ok).toBe(false);
    expect(logs.code).toBe('OUTPUT_LIMIT');
  });

  it('identical replay returns the same execution; divergent hash conflicts; principals isolate', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({ artifacts, ontology });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads,
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    const first = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
      parameters: { n: 1 },
      idempotencyKey: 'k1',
    });
    const replay = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
      parameters: { n: 1 },
      idempotencyKey: 'k1',
    });
    expect(replay.executionId).toBe(first.executionId);
    await expect(
      runtime.create({
        ontologyId: seeded.ontologyId,
        functionId: 'echo',
        principal: 'alice',
        parameters: { n: 2 },
        idempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(FunctionIdempotencyConflictError);
    const bob = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'bob',
      parameters: { n: 1 },
      idempotencyKey: 'k1',
    });
    expect(bob.executionId).not.toBe(first.executionId);
    expect(await runtime.get(first.executionId, 'bob')).toBeUndefined();
  });

  it('retry after Action commit does not duplicate the Action; terminal does not reopen', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({
      artifacts,
      ontology,
      source:
        'function(input, host) { return { result: { ok: true }, actions: [{ step: "s1", actionApiName: "setN", parameters: { n: 2 } }] }; }',
    });
    const applied = new Map<string, ActionApplyResult>();
    let applies = 0;
    let crash = true;
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads,
      actions: {
        async apply(req: ActionApplyRequest) {
          const key = req.idempotencyKey ?? '';
          const existing = applied.get(key);
          if (existing) return existing;
          applies += 1;
          const result: ActionApplyResult = {
            executionId: `act-${applies}`,
            status: 'SUCCEEDED',
            actionTypeId: 'act.setN',
          };
          applied.set(key, result);
          return result;
        },
      },
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
      afterActionBeforeResult: async () => {
        if (crash) {
          crash = false;
          throw new FunctionCrashFailpointError();
        }
      },
    });
    const created = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
    });
    await expect(runtime.runOnce(created.executionId, 'w1')).rejects.toBeInstanceOf(
      FunctionCrashFailpointError,
    );
    expect(applies).toBe(1);
    const again = await runtime.runOnce(created.executionId, 'w1');
    expect(again.status).toBe('SUCCEEDED');
    expect(applies).toBe(1);
    expect(derivedActionIdempotencyKey(created.executionId, 's1')).toBe(
      `fn:${created.executionId}:s1`,
    );
    const cancelled = await runtime.cancel(created.executionId, 'alice');
    expect(cancelled.status).toBe('SUCCEEDED');
    const rerun = await runtime.runOnce(created.executionId, 'w2');
    expect(rerun.status).toBe('SUCCEEDED');
  });

  it('unavailable snapshot fails closed with zero sandbox', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const counted = countingGets(artifacts);
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({ artifacts, ontology });
    let missing = false;
    const gated: FunctionObjectReader = {
      async currentSeq() {
        return 1;
      },
      async getObject(_p, _o, objectTypeId, primaryKey) {
        if (missing) throw new FunctionSnapshotUnavailableError();
        return { objectTypeId, primaryKey, properties: { n: 1 } };
      },
    };
    let actionCalls = 0;
    const runtime = createFunctionRuntime({
      artifacts: counted.store,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads: gated,
      actions: {
        async apply() {
          actionCalls += 1;
          return { executionId: 'act-1', status: 'SUCCEEDED', actionTypeId: 'act.setN' };
        },
      },
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    missing = true;
    await expect(
      runtime.create({
        ontologyId: seeded.ontologyId,
        functionId: 'echo',
        principal: 'alice',
        objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
      }),
    ).rejects.toBeInstanceOf(FunctionSnapshotUnavailableError);
    missing = false;
    const created = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
      objectRefs: [{ objectTypeId: 'ot.record', primaryKey: 'A' }],
    });
    missing = true;
    const failed = await runtime.runOnce(created.executionId, 'w1');
    expect(failed.status).toBe('FAILED');
    expect(failed.error?.code).toBe('FUNCTION_SNAPSHOT_UNAVAILABLE');
    expect(counted.gets()).toBe(0);
    expect(actionCalls).toBe(0);
  });

  it('worker drainOnce executes a pending pin', async () => {
    const clock = createDeterministicClock();
    const artifacts = createMemoryFunctionArtifactStore({ clock });
    const executions = createMemoryFunctionExecutionStore();
    const ontology = createOntologyRegistry();
    const seeded = await seedFunction({ artifacts, ontology });
    const runtime = createFunctionRuntime({
      artifacts,
      executions,
      resolver: createFunctionDefinitionResolver({ ontology }),
      ontology,
      authorize: decisionOf('allow'),
      reads,
      policyGeneration: () => 1,
      clock,
      nextId: createIdGenerator(),
    });
    const created = await runtime.create({
      ontologyId: seeded.ontologyId,
      functionId: 'echo',
      principal: 'alice',
    });
    const worker = createFunctionWorker({
      runtime,
      executions,
      clock,
      workerId: 'w-drain',
    });
    expect(await worker.drainOnce()).toBe(1);
    const done = await runtime.get(created.executionId, 'alice');
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.result).toEqual({ v: 1 });
  });
});
