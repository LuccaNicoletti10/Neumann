/**
 * action-engine — src/core/execution-store.ts
 * In-memory ActionExecutionStore (tests/demos only).
 */

import type { ActionExecution, ActionExecutionStore } from 'contracts';

function idemKey(
  ontologyId: string,
  actionApiName: string,
  idempotencyKey: string,
): string {
  return `${ontologyId}::${actionApiName}::${idempotencyKey}`;
}

export function createMemoryActionExecutionStore(): ActionExecutionStore {
  const executions = new Map<string, ActionExecution>();
  const idempotency = new Map<string, string>();

  return {
    async save(execution) {
      executions.set(execution.id, { ...execution });
      if (execution.idempotencyKey) {
        idempotency.set(
          idemKey(execution.ontologyId, execution.actionApiName, execution.idempotencyKey),
          execution.id,
        );
      }
    },

    async get(id) {
      const e = executions.get(id);
      return e ? { ...e } : undefined;
    },

    async findByIdempotencyKey(ontologyId, actionApiName, key) {
      const id = idempotency.get(idemKey(ontologyId, actionApiName, key));
      return id ? this.get(id) : undefined;
    },

    async claim(execution) {
      if (execution.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(
          execution.ontologyId,
          execution.actionApiName,
          execution.idempotencyKey,
        );
        if (existing) return { claimed: false, execution: existing };
      }
      await this.save(execution);
      return { claimed: true, execution: { ...execution } };
    },
  };
}
