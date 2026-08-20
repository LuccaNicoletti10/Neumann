/**
 * action-engine — src/core/execution-store.ts
 * In-memory ActionExecutionStore (tests/demos only).
 */

import type { ActionExecution, ActionExecutionStore } from 'contracts';
import type { MemoryCheckpoint } from 'object-platform';
import { restoreMap } from 'object-platform';

function idemKey(
  ontologyId: string,
  actionApiName: string,
  idempotencyKey: string,
  principal: string,
): string {
  // WHY: principal is part of the idempotency scope so that different principals
  // with the same key produce independent executions (not a cross-principal replay).
  return `${ontologyId}::${principal}::${actionApiName}::${idempotencyKey}`;
}

export function createMemoryActionExecutionStore(): ActionExecutionStore & MemoryCheckpoint {
  const executions = new Map<string, ActionExecution>();
  const idempotency = new Map<string, string>();

  return {
    async save(execution) {
      executions.set(execution.id, { ...execution });
      if (execution.idempotencyKey) {
        idempotency.set(
          idemKey(execution.ontologyId, execution.actionApiName, execution.idempotencyKey, execution.principal),
          execution.id,
        );
      }
    },

    async get(id) {
      const e = executions.get(id);
      return e ? { ...e } : undefined;
    },

    async findByIdempotencyKey(ontologyId, actionApiName, key, principal) {
      // WHY: lookup is scoped to the caller's principal — a caller must never
      // retrieve another principal's execution. The idemKey already encodes
      // principal, so the lookup is direct and O(1).
      const k = idemKey(ontologyId, actionApiName, key, principal);
      const id = idempotency.get(k);
      return id ? this.get(id) : undefined;
    },

    async claim(execution) {
      if (execution.idempotencyKey) {
        // WHY: scope idempotency by principal so different principals with the same
        // key produce independent executions, not cross-principal replays.
        const principalKey = idemKey(
          execution.ontologyId,
          execution.actionApiName,
          execution.idempotencyKey,
          execution.principal,
        );
        const existingId = idempotency.get(principalKey);
        if (existingId) {
          const existing = executions.get(existingId);
          if (existing) {
            // WHY: same key + same principal + different hash = IDEMPOTENCY_CONFLICT.
            if (
              execution.requestHash &&
              existing.requestHash &&
              existing.requestHash !== execution.requestHash
            ) {
              const err: Error & { code?: string } = new Error(
                `idempotency conflict: same key "${execution.idempotencyKey}" previously used with a different request hash`,
              );
              err.code = 'IDEMPOTENCY_CONFLICT';
              throw err;
            }
            return { claimed: false, execution: { ...existing } };
          }
        }
      }
      await this.save(execution);
      return { claimed: true, execution: { ...execution } };
    },

    async casStatus(id, from, to, patch) {
      const existing = executions.get(id);
      if (!existing || existing.status !== from) return undefined;
      const next = { ...existing, ...patch, status: to };
      executions.set(id, next);
      return { ...next };
    },

    capture() {
      return {
        executions: new Map(
          [...executions.entries()].map(([k, v]) => [k, { ...v }]),
        ),
        idempotency: new Map(idempotency),
      };
    },

    restore(snapshot: unknown) {
      const snap = snapshot as {
        executions: Map<string, ActionExecution>;
        idempotency: Map<string, string>;
      };
      restoreMap(executions, snap.executions);
      restoreMap(idempotency, snap.idempotency);
    },
  };
}
