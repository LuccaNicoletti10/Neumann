/**
 * connector-sdk — src/core/checkpoint-store.ts
 * Persistência de cursor opaco entre restarts.
 */

import type { Cursor } from 'contracts';

export interface CheckpointStore {
  get(connectorId: string, objectName: string): Promise<Cursor | null>;
  set(connectorId: string, objectName: string, cursor: Cursor): Promise<void>;
  delete(connectorId: string, objectName: string): Promise<void>;
}

function key(connectorId: string, objectName: string): string {
  return `${connectorId}::${objectName}`;
}

export function createMemoryCheckpointStore(
  initial?: Iterable<[string, Cursor]>,
): CheckpointStore {
  const map = new Map<string, Cursor>(initial);
  return {
    async get(connectorId, objectName) {
      return map.get(key(connectorId, objectName)) ?? null;
    },
    async set(connectorId, objectName, cursor) {
      map.set(key(connectorId, objectName), { token: cursor.token });
    },
    async delete(connectorId, objectName) {
      map.delete(key(connectorId, objectName));
    },
  };
}
