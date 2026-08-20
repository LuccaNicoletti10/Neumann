import {
  allowsMutation,
  isFunctionTerminal,
  type ActionExecutor,
  type AuthorizeFn,
  type FunctionActionInvocation,
  type FunctionArtifactStore,
  type FunctionCreateRequest,
  type FunctionDefinitionResolver,
  type FunctionExecution,
  type FunctionExecutionPin,
  type FunctionObjectInput,
  type FunctionRuntime,
  type FunctionTypedError,
  type OntologyRegistry,
} from 'contracts';
import { ResourceIds } from 'policy-engine';
import type { Clock, IdGenerator } from 'object-platform';

import { derivedActionIdempotencyKey, type FunctionActionInvoker } from './action-invoker.js';
import {
  FunctionDeniedError,
  FunctionIdempotencyConflictError,
  FunctionInvalidParametersError,
  FunctionLeaseHeldError,
  FunctionSnapshotUnavailableError,
  FunctionTerminalError,
} from './errors.js';
import type { FunctionExecutionRecord, FunctionExecutionStore } from './execution-store.js';
import { functionLogAllowed, type FunctionLogEvent } from './log-redaction.js';
import { buildFunctionRequestHash, hashFunctionParameters } from './request-identity.js';
import { runFunctionArtifact, type FunctionSandboxLimits } from './sandbox-runner.js';

export interface FunctionObjectReader {
  currentSeq(): Promise<number>;
  getObject(
    principal: string,
    ontologyId: string,
    objectTypeId: string,
    primaryKey: string,
    readAsOf: string,
    readSeq: number,
  ): Promise<FunctionObjectInput | undefined>;
}

export interface CreateFunctionRuntimeOptions {
  artifacts: FunctionArtifactStore;
  executions: FunctionExecutionStore;
  resolver: FunctionDefinitionResolver;
  ontology: OntologyRegistry;
  authorize: AuthorizeFn;
  reads: FunctionObjectReader;
  actions?: FunctionActionInvoker;
  policyGeneration: () => number;
  clock: Clock;
  nextId: IdGenerator;
  limits?: Partial<FunctionSandboxLimits>;
  leaseMs?: number;
  log?: (event: FunctionLogEvent) => void;
  /**
   * Test-only. Invoked after ActionExecutor.apply and before persisting function result.
   * Production must not set this.
   */
  afterActionBeforeResult?: () => Promise<void>;
}

const DEFAULT_LIMITS: FunctionSandboxLimits = {
  timeoutMs: 1_000,
  maxOutputBytes: 32_000,
  maxMemoryMb: 64,
  maxLogBytes: 4_000,
};

function publicExecution(row: FunctionExecutionRecord): FunctionExecution {
  const { logEvents: _logs, ...rest } = row;
  return rest;
}

function asActions(output: unknown): { result: unknown; actions: FunctionActionInvocation[] } {
  if (output && typeof output === 'object' && !Array.isArray(output) && 'actions' in output) {
    const rec = output as { actions?: unknown; result?: unknown };
    const actions = Array.isArray(rec.actions) ? (rec.actions as FunctionActionInvocation[]) : [];
    const { actions: _a, ...rest } = rec as Record<string, unknown> & { actions?: unknown };
    return { result: rest.result !== undefined ? rest.result : rest, actions };
  }
  return { result: output, actions: [] };
}

function invalidOutput(output: unknown): boolean {
  return output === undefined;
}

export function createFunctionRuntime(opts: CreateFunctionRuntimeOptions): FunctionRuntime {
  const limits: FunctionSandboxLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const leaseMs = opts.leaseMs ?? 15_000;
  const emit = (event: FunctionLogEvent) => {
    opts.log?.(functionLogAllowed(event));
  };

  async function authorizeFunction(principal: string, ontologyId: string, functionId: string): Promise<void> {
    const decision = opts.authorize({
      principal,
      resource: ResourceIds.function(ontologyId, functionId),
      operation: 'modify',
    });
    if (!allowsMutation(decision)) throw new FunctionDeniedError();
  }

  async function loadSnapshot(
    req: FunctionCreateRequest,
    readAsOf: string,
    readSeq: number,
  ): Promise<FunctionObjectInput[]> {
    const snapshot: FunctionObjectInput[] = [];
    for (const ref of req.objectRefs ?? []) {
      const rec = await opts.reads.getObject(
        req.principal,
        req.ontologyId,
        ref.objectTypeId,
        ref.primaryKey,
        readAsOf,
        readSeq,
      );
      if (!rec) throw new FunctionDeniedError();
      snapshot.push({
        objectTypeId: rec.objectTypeId,
        primaryKey: rec.primaryKey,
        properties: { ...rec.properties },
      });
    }
    return snapshot;
  }

  return {
    async create(req) {
      let pin: FunctionExecutionPin;
      try {
        pin = await opts.resolver.pin({
          ontologyId: req.ontologyId,
          functionId: req.functionId,
          ontologyVersionId: req.ontologyVersionId,
        });
      } catch {
        throw new FunctionDeniedError();
      }
      const version = await opts.ontology.getVersion(pin.ontologyVersionId);
      const def = version?.functionTypes[pin.functionId];
      await authorizeFunction(req.principal, pin.ontologyId, def?.apiName ?? pin.functionId);
      if (def?.inputSchema) {
        const required = Array.isArray((def.inputSchema as { required?: unknown }).required)
          ? ((def.inputSchema as { required: string[] }).required)
          : [];
        for (const key of required) {
          if (req.parameters?.[key] === undefined) {
            throw new FunctionInvalidParametersError();
          }
        }
      }
      const readAsOf = opts.clock();
      const readSeq = await opts.reads.currentSeq();
      const parameters = req.parameters ?? {};
      const objectRefs = req.objectRefs ?? [];
      const objectSnapshot = await loadSnapshot(req, readAsOf, readSeq);
      const parametersHash = hashFunctionParameters(parameters);
      const requestHash = req.idempotencyKey
        ? buildFunctionRequestHash({
            pin,
            principal: req.principal,
            parameters,
            objectRefs,
          })
        : undefined;
      if (req.idempotencyKey) {
        const existing = await opts.executions.findByScope({
          ontologyId: pin.ontologyId,
          principal: req.principal,
          functionId: pin.functionId,
          idempotencyKey: req.idempotencyKey,
        });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new FunctionIdempotencyConflictError();
          return publicExecution(existing);
        }
      }
      const now = readAsOf;
      const execution: FunctionExecutionRecord = {
        executionId: opts.nextId('fnexec'),
        pin,
        principal: req.principal,
        parameters,
        parametersHash,
        objectRefs,
        objectSnapshot,
        readAsOf,
        readSeq,
        policyGeneration: opts.policyGeneration(),
        idempotencyKey: req.idempotencyKey,
        requestHash,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        attempt: 0,
        logEvents: [],
      };
      const saved = await opts.executions.insert(execution);
      emit({
        code: 'FUNCTION_ACCEPTED',
        executionId: saved.executionId,
        functionId: pin.functionId,
        artifactHash: pin.artifactHash,
      });
      return publicExecution(saved);
    },

    async get(executionId, principal) {
      const row = await opts.executions.findById(executionId);
      if (!row || row.principal !== principal) return undefined;
      return publicExecution(row);
    },

    async cancel(executionId, principal) {
      const row = await opts.executions.findById(executionId);
      if (!row || row.principal !== principal) throw new FunctionDeniedError();
      if (row.status === 'CANCELLED') return publicExecution(row);
      const now = opts.clock();
      try {
        const updated = await opts.executions.casStatus({
          executionId,
          from: ['PENDING', 'RUNNING'],
          to: 'CANCELLED',
          now,
          error: { code: 'CANCELLED', message: 'cancelled' },
        });
        return publicExecution(updated);
      } catch (err) {
        if (err instanceof FunctionTerminalError) {
          const current = await opts.executions.findById(executionId);
          if (current) return publicExecution(current);
        }
        throw err;
      }
    },

    async runOnce(executionId, workerId, signal) {
      const now = opts.clock();
      const existing = await opts.executions.findById(executionId);
      if (existing && isFunctionTerminal(existing.status)) return publicExecution(existing);
      let claimed: FunctionExecutionRecord;
      try {
        // WHY: worker.claimNext already holds the lease; do not steal it from ourselves.
        if (existing?.status === 'RUNNING' && existing.leaseOwner === workerId) {
          claimed = existing;
        } else {
          claimed = await opts.executions.claim(executionId, workerId, now, leaseMs);
        }
      } catch (err) {
        if (err instanceof FunctionTerminalError) {
          const current = await opts.executions.findById(executionId);
          if (current) return publicExecution(current);
        }
        throw err;
      }
      try {
        const pinnedVersion = await opts.ontology.getVersion(claimed.pin.ontologyVersionId);
        const pinnedDef = pinnedVersion?.functionTypes[claimed.pin.functionId];
        await authorizeFunction(
          claimed.principal,
          claimed.pin.ontologyId,
          pinnedDef?.apiName ?? claimed.pin.functionId,
        );
      } catch (err) {
        if (err instanceof FunctionDeniedError) {
          const denied = await opts.executions.casStatus({
            executionId,
            from: 'RUNNING',
            to: 'DENIED',
            now: opts.clock(),
            error: { code: 'DENIED', message: 'denied' },
          });
          emit({
            code: 'FUNCTION_DENIED',
            executionId,
            functionId: claimed.pin.functionId,
            errorCode: 'DENIED',
          });
          return publicExecution(denied);
        }
        throw err;
      }
      if (signal?.aborted) {
        return publicExecution(
          await opts.executions.casStatus({
            executionId,
            from: 'RUNNING',
            to: 'CANCELLED',
            now: opts.clock(),
            error: { code: 'CANCELLED', message: 'cancelled' },
          }),
        );
      }
      let objectsForSandbox: FunctionObjectInput[];
      try {
        // WHY: runOnce re-reads asOf(readAsOf) so current policy/redaction
        // apply to the historical snapshot; the live row is never consulted.
        objectsForSandbox = await loadSnapshot(
          {
            ontologyId: claimed.pin.ontologyId,
            functionId: claimed.pin.functionId,
            principal: claimed.principal,
            objectRefs: claimed.objectRefs,
          },
          claimed.readAsOf,
          claimed.readSeq,
        );
      } catch (err) {
        if (err instanceof FunctionDeniedError) {
          const denied = await opts.executions.casStatus({
            executionId,
            from: 'RUNNING',
            to: 'DENIED',
            now: opts.clock(),
            error: { code: 'DENIED', message: 'denied' },
          });
          return publicExecution(denied);
        }
        if (err instanceof FunctionSnapshotUnavailableError) {
          return publicExecution(
            await opts.executions.casStatus({
              executionId,
              from: 'RUNNING',
              to: 'FAILED',
              now: opts.clock(),
              error: {
                code: 'FUNCTION_SNAPSHOT_UNAVAILABLE',
                message: 'snapshot unavailable at readAsOf',
              },
            }),
          );
        }
        throw err;
      }
      const artifact = await opts.artifacts.get(claimed.pin.artifactHash);
      const sandboxed = await runFunctionArtifact({
        bytes: artifact.bytes,
        objects: objectsForSandbox,
        parameters: claimed.parameters,
        clock: claimed.readAsOf,
        executionId: claimed.executionId,
        limits,
        signal,
      });
      if (!sandboxed.ok) {
        const error: FunctionTypedError = {
          code: sandboxed.code ?? 'EXECUTION_ERROR',
          message: sandboxed.detail ?? 'execution failed',
        };
        return publicExecution(
          await opts.executions.casStatus({
            executionId,
            from: 'RUNNING',
            to: error.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
            now: opts.clock(),
            error,
          }),
        );
      }
      if (invalidOutput(sandboxed.output)) {
        return publicExecution(
          await opts.executions.casStatus({
            executionId,
            from: 'RUNNING',
            to: 'FAILED',
            now: opts.clock(),
            error: { code: 'INVALID_OUTPUT', message: 'output invalid' },
          }),
        );
      }
      const split = asActions(sandboxed.output);
      const actionIds: string[] = [];
      if (split.actions.length > 0) {
        const invoker: ActionExecutor | FunctionActionInvoker | undefined = opts.actions;
        if (!invoker) {
          return publicExecution(
            await opts.executions.casStatus({
              executionId,
              from: 'RUNNING',
              to: 'FAILED',
              now: opts.clock(),
              error: { code: 'EXECUTION_ERROR', message: 'ActionInvoker not configured' },
            }),
          );
        }
        for (const invocation of split.actions) {
          const applied = await invoker.apply({
            ontologyId: claimed.pin.ontologyId,
            ontologyVersionId: claimed.pin.ontologyVersionId,
            actionApiName: invocation.actionApiName,
            parameters: invocation.parameters,
            principal: claimed.principal,
            idempotencyKey: derivedActionIdempotencyKey(claimed.executionId, invocation.step),
            expectedObjectVersions: invocation.expectedObjectVersions,
          });
          if (applied.status !== 'SUCCEEDED') {
            return publicExecution(
              await opts.executions.casStatus({
                executionId,
                from: 'RUNNING',
                to: 'FAILED',
                now: opts.clock(),
                error: {
                  code: 'EXECUTION_ERROR',
                  message: applied.error ?? `action ${invocation.actionApiName} ${applied.status}`,
                },
              }),
            );
          }
          actionIds.push(applied.executionId);
          if (opts.afterActionBeforeResult) await opts.afterActionBeforeResult();
        }
      }
      const result =
        actionIds.length > 0 ? { value: split.result, actionExecutionIds: actionIds } : split.result;
      return publicExecution(
        await opts.executions.casStatus({
          executionId,
          from: 'RUNNING',
          to: 'SUCCEEDED',
          now: opts.clock(),
          result,
        }),
      );
    },
  };
}

export { FunctionLeaseHeldError };
