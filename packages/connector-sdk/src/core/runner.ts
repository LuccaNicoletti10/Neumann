/**
 * connector-sdk — src/core/runner.ts
 * runSnapshot / runIncremental com persistência de checkpoint.
 */

import type { CanonicalEvent, Connector, Cursor, ObjectRef } from 'contracts';

import type { CheckpointStore } from './checkpoint-store.js';

export interface RunOptions {
  connector: Connector;
  store: CheckpointStore;
  object: ObjectRef;
  /** Persistir checkpoint a cada N eventos (default 1 = após cada evento). */
  persistEvery?: number;
  /** Abortar após N eventos (útil para gate T1.3). */
  abortAfter?: number;
  onEvent?: (event: CanonicalEvent, index: number) => void | Promise<void>;
}

export interface RunResult {
  events: CanonicalEvent[];
  aborted: boolean;
  checkpoint: Cursor;
}

async function persist(
  store: CheckpointStore,
  connector: Connector,
  objectName: string,
): Promise<Cursor> {
  const cursor = await connector.checkpoint();
  await store.set(connector.connectorId, objectName, cursor);
  return cursor;
}

/**
 * Consome `snapshot(obj)`, persistindo checkpoint periodicamente.
 * Se `abortAfter` for atingido, para e grava o checkpoint atual.
 */
export async function runSnapshot(opts: RunOptions): Promise<RunResult> {
  const persistEvery = opts.persistEvery ?? 1;
  const events: CanonicalEvent[] = [];
  let aborted = false;
  let index = 0;

  for await (const event of opts.connector.snapshot(opts.object)) {
    events.push(event);
    index += 1;
    if (opts.onEvent) await opts.onEvent(event, index);
    if (index % persistEvery === 0) {
      await persist(opts.store, opts.connector, opts.object.objectName);
    }
    if (opts.abortAfter !== undefined && index >= opts.abortAfter) {
      aborted = true;
      break;
    }
  }

  const checkpoint = await persist(opts.store, opts.connector, opts.object.objectName);
  return { events, aborted, checkpoint };
}

/**
 * Consome `read(cursor)` a partir do checkpoint salvo (ou cursor vazio).
 */
export async function runIncremental(opts: RunOptions): Promise<RunResult> {
  const persistEvery = opts.persistEvery ?? 1;
  const saved = await opts.store.get(opts.connector.connectorId, opts.object.objectName);
  const start: Cursor = saved ?? { token: '' };
  const events: CanonicalEvent[] = [];
  let aborted = false;
  let index = 0;

  for await (const event of opts.connector.read(start)) {
    events.push(event);
    index += 1;
    if (opts.onEvent) await opts.onEvent(event, index);
    if (index % persistEvery === 0) {
      await persist(opts.store, opts.connector, opts.object.objectName);
    }
    if (opts.abortAfter !== undefined && index >= opts.abortAfter) {
      aborted = true;
      break;
    }
  }

  const checkpoint = await persist(opts.store, opts.connector, opts.object.objectName);
  return { events, aborted, checkpoint };
}
