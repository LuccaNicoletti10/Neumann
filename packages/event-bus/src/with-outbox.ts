import type { OutboxStore, OutboxTransaction } from './store/memory-outbox.js';

export async function withOutbox<T>(
  store: OutboxStore,
  fn: (tx: OutboxTransaction) => Promise<T> | T,
): Promise<T> {
  const tx = store.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    tx.rollback();
    throw err;
  }
}
