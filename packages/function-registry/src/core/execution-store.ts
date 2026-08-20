import type {
  FunctionExecution,
  FunctionExecutionPin,
  FunctionExecutionStatus,
  FunctionObjectInput,
  FunctionObjectRef,
  FunctionTypedError,
} from 'contracts';
import { assertFunctionExecutionPin, isFunctionTerminal } from 'contracts';

import { FunctionIdempotencyConflictError, FunctionLeaseHeldError, FunctionTerminalError } from './errors.js';

export interface FunctionExecutionRecord extends FunctionExecution {
  logEvents: unknown[];
}

export interface FunctionExecutionStore {
  insert(execution: FunctionExecutionRecord): Promise<FunctionExecutionRecord>;
  findById(executionId: string): Promise<FunctionExecutionRecord | undefined>;
  findByScope(scope: {
    ontologyId: string;
    principal: string;
    functionId: string;
    idempotencyKey: string;
  }): Promise<FunctionExecutionRecord | undefined>;
  claimNext(workerId: string, now: string, leaseMs: number): Promise<FunctionExecutionRecord | undefined>;
  claim(executionId: string, workerId: string, now: string, leaseMs: number): Promise<FunctionExecutionRecord>;
  casStatus(input: {
    executionId: string;
    from: FunctionExecutionStatus | FunctionExecutionStatus[];
    to: FunctionExecutionStatus;
    now: string;
    result?: unknown;
    error?: FunctionTypedError;
    logEvents?: unknown[];
    leaseOwner?: string | null;
  }): Promise<FunctionExecutionRecord>;
}

function clone(record: FunctionExecutionRecord): FunctionExecutionRecord {
  return structuredClone(record);
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function matchesFrom(status: FunctionExecutionStatus, from: FunctionExecutionStatus | FunctionExecutionStatus[]): boolean {
  return Array.isArray(from) ? from.includes(status) : status === from;
}

export function createMemoryFunctionExecutionStore(): FunctionExecutionStore {
  const byId = new Map<string, FunctionExecutionRecord>();
  const byScope = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();

  function scopeKey(ontologyId: string, principal: string, functionId: string, key: string): string {
    return `${ontologyId}\0${principal}\0${functionId}\0${key}`;
  }

  function serialize<T>(fn: () => T): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    async insert(execution) {
      return serialize(() => {
        if (execution.idempotencyKey) {
          const key = scopeKey(
            execution.pin.ontologyId,
            execution.principal,
            execution.pin.functionId,
            execution.idempotencyKey,
          );
          const existingId = byScope.get(key);
          if (existingId) {
            const existing = byId.get(existingId)!;
            if (existing.requestHash !== execution.requestHash) {
              throw new FunctionIdempotencyConflictError();
            }
            return clone(existing);
          }
          byScope.set(key, execution.executionId);
        }
        byId.set(execution.executionId, clone(execution));
        return clone(execution);
      });
    },
    async findById(executionId) {
      const row = byId.get(executionId);
      return row ? clone(row) : undefined;
    },
    async findByScope(scope) {
      const id = byScope.get(
        scopeKey(scope.ontologyId, scope.principal, scope.functionId, scope.idempotencyKey),
      );
      return id ? clone(byId.get(id)!) : undefined;
    },
    async claimNext(workerId, now, leaseMs) {
      return serialize(() => {
        const nowMs = Date.parse(now);
        const candidates = [...byId.values()]
          .filter(
            (row) =>
              row.status === 'PENDING' ||
              (row.status === 'RUNNING' &&
                row.leaseExpiresAt != null &&
                Date.parse(row.leaseExpiresAt) <= nowMs),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const next = candidates[0];
        if (!next) return undefined;
        next.status = 'RUNNING';
        next.leaseOwner = workerId;
        next.leaseExpiresAt = addMs(now, leaseMs);
        next.attempt += 1;
        next.startedAt = next.startedAt ?? now;
        next.updatedAt = now;
        byId.set(next.executionId, next);
        return clone(next);
      });
    },
    async claim(executionId, workerId, now, leaseMs) {
      return serialize(() => {
        const row = byId.get(executionId);
        if (!row) throw new FunctionLeaseHeldError(executionId);
        const nowMs = Date.parse(now);
        const expired =
          row.status === 'RUNNING' &&
          row.leaseExpiresAt != null &&
          Date.parse(row.leaseExpiresAt) <= nowMs;
        if (row.status !== 'PENDING' && !expired) {
          if (isFunctionTerminal(row.status)) throw new FunctionTerminalError();
          throw new FunctionLeaseHeldError(executionId);
        }
        row.status = 'RUNNING';
        row.leaseOwner = workerId;
        row.leaseExpiresAt = addMs(now, leaseMs);
        row.attempt += 1;
        row.startedAt = row.startedAt ?? now;
        row.updatedAt = now;
        return clone(row);
      });
    },
    async casStatus(input) {
      return serialize(() => {
        const row = byId.get(input.executionId);
        if (!row || !matchesFrom(row.status, input.from)) {
          throw new FunctionTerminalError();
        }
        if (isFunctionTerminal(row.status)) throw new FunctionTerminalError();
        row.status = input.to;
        row.updatedAt = input.now;
        if (input.leaseOwner === null) {
          row.leaseOwner = undefined;
          row.leaseExpiresAt = undefined;
        }
        if (input.result !== undefined) row.result = input.result;
        if (input.error) row.error = input.error;
        if (input.logEvents) row.logEvents = input.logEvents;
        if (isFunctionTerminal(input.to)) {
          row.finishedAt = input.now;
          row.leaseOwner = undefined;
          row.leaseExpiresAt = undefined;
        }
        return clone(row);
      });
    },
  };
}

export function pinOf(execution: FunctionExecution): FunctionExecutionPin {
  assertFunctionExecutionPin(execution.pin);
  return execution.pin;
}

export function snapshotOf(value: unknown): FunctionObjectInput[] {
  if (!Array.isArray(value)) return [];
  return value as FunctionObjectInput[];
}

export function refsOf(value: unknown): FunctionObjectRef[] {
  if (!Array.isArray(value)) return [];
  return value as FunctionObjectRef[];
}
