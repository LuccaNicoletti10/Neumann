/**
 * object-platform — src/core/memory-transaction-boundary.ts
 *
 * Concurrency-safe UnitOfWork for the memory test double.
 *
 * WHY not a bare snapshot/restore: capture() at run() start and restore() on
 * throw is only correct while a single transaction touches the stores. Two
 * overlapping runs make restore() write the aborting transaction's opening
 * generation over a commit that another transaction already made — silent lost
 * update, which PostgreSQL never does.
 *
 * Strategy: serialize commits per store set, then snapshot/restore inside the
 * critical section. Rollback therefore observes only its own writes.
 *
 * WHY union of locks: stores are shared singletons, so two boundaries built
 * over overlapping stores must serialize against each other. Every store keeps
 * a union-find node; boundaries that touch a common store collapse to one lock.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { isMemoryCheckpoint, type MemoryCheckpoint } from './memory-checkpoint.js';

interface LockNode {
  parent?: LockNode;
  /** Tail of the serialized chain. Resolves when the current holder releases. */
  tail: Promise<void>;
}

const nodeOf = new WeakMap<MemoryCheckpoint, LockNode>();

/** WHY: a nested run() would await its own lock. Fail fast instead of hanging. */
const held = new AsyncLocalStorage<Set<LockNode>>();

function rootOf(node: LockNode): LockNode {
  let current = node;
  while (current.parent) current = current.parent;
  // Path compression keeps rootOf O(1) after the first walk.
  let walk = node;
  while (walk.parent && walk.parent !== current) {
    const next = walk.parent;
    walk.parent = current;
    walk = next;
  }
  return current;
}

function lockFor(checkpoints: readonly MemoryCheckpoint[]): LockNode {
  let chosen: LockNode | undefined;
  for (const checkpoint of checkpoints) {
    const existing = nodeOf.get(checkpoint);
    if (!existing) continue;
    const root = rootOf(existing);
    if (!chosen) {
      chosen = root;
      continue;
    }
    if (root !== chosen) {
      root.parent = chosen;
      const merged = Promise.all([chosen.tail, root.tail]).then(() => undefined);
      chosen.tail = merged;
    }
  }
  const target: LockNode = chosen ?? { tail: Promise.resolve() };
  for (const checkpoint of checkpoints) {
    if (!nodeOf.has(checkpoint)) nodeOf.set(checkpoint, target);
  }
  return target;
}

export interface MemoryTransaction<S> {
  run<T>(fn: (stores: S) => Promise<T>): Promise<T>;
}

export interface MemoryTransactionBoundary {
  /**
   * Derive a UnitOfWork over this boundary. Every UnitOfWork derived from the
   * same boundary shares the commit lock and the rollback set.
   */
  unitOfWork<S>(bind: () => S): MemoryTransaction<S>;
  /** Stores enrolled in the rollback set. */
  readonly stores: readonly MemoryCheckpoint[];
}

export class NestedMemoryTransactionError extends Error {
  constructor() {
    super(
      'nested memory transaction refused: the inner run() would wait on the lock its caller holds',
    );
    this.name = 'NestedMemoryTransactionError';
  }
}

/**
 * @throws if any listed store is not checkpointable (fail-closed: a store that
 * cannot roll back must not sit inside a transaction boundary silently).
 */
export function createMemoryTransactionBoundary(
  stores: readonly unknown[],
): MemoryTransactionBoundary {
  const checkpoints: MemoryCheckpoint[] = [];
  for (const store of stores) {
    if (!isMemoryCheckpoint(store)) {
      throw new Error(
        'createMemoryTransactionBoundary requires checkpointable memory stores',
      );
    }
    if (!checkpoints.includes(store)) checkpoints.push(store);
  }
  const lock = lockFor(checkpoints);

  async function commit<T>(fn: () => Promise<T>): Promise<T> {
    const root = rootOf(lock);
    const outer = held.getStore();
    // WHY rootOf on every held node: a boundary created after `outer` started may
    // have merged its lock into ours, so identity on the stored node is not enough.
    if (outer) {
      for (const node of outer) {
        if (rootOf(node) === root) throw new NestedMemoryTransactionError();
      }
    }

    const previous = root.tail;
    let release!: () => void;
    root.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const scope = new Set(outer ?? []);
    scope.add(root);
    try {
      return await held.run(scope, async () => {
        const snapshots = checkpoints.map((c) => c.capture());
        try {
          return await fn();
        } catch (err) {
          for (let i = 0; i < checkpoints.length; i++) {
            checkpoints[i]!.restore(snapshots[i]);
          }
          throw err;
        }
      });
    } finally {
      release();
    }
  }

  return {
    stores: checkpoints,
    unitOfWork<S>(bind: () => S): MemoryTransaction<S> {
      return { run: (fn) => commit(() => fn(bind())) };
    },
  };
}

export type SnapshotUnitOfWork<S> = MemoryTransaction<S>;

/** One boundary, one UnitOfWork. Shorthand for a caller with a single store set. */
export function createSnapshotUnitOfWork<S>(
  stores: readonly unknown[],
  bind: () => S,
): MemoryTransaction<S> {
  return createMemoryTransactionBoundary(stores).unitOfWork(bind);
}
