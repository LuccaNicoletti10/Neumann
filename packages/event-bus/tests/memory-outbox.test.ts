import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryTransactionalStore } from '../src/store/memory-outbox.js';
import { withOutbox } from '../src/with-outbox.js';

describe('InMemoryTransactionalStore', () => {
  it('commits business data and outbox atomically', async () => {
    const store = new InMemoryTransactionalStore();
    const eventId = randomUUID();

    await withOutbox(store, (tx) => {
      tx.writeBusiness('orders', { id: 1 });
      tx.insertOutbox({
        eventId,
        topic: 'orders',
        key: 'orders+1',
        payload: { id: 1 },
        principal: 'user',
        tenantId: 't1',
        traceId: randomUUID(),
      });
    });

    expect(store.getBusinessRows('orders')).toHaveLength(1);
    expect(store.listUnpublished()).toHaveLength(1);
    expect(store.listUnpublished()[0]?.eventId).toBe(eventId);
  });

  it('rollback loses both business and outbox writes', async () => {
    const store = new InMemoryTransactionalStore();
    const tx = store.begin();
    tx.writeBusiness('orders', { id: 2 });
    tx.insertOutbox({
      topic: 'orders',
      key: 'orders+2',
      payload: { id: 2 },
      principal: 'user',
      tenantId: 't1',
      traceId: randomUUID(),
    });
    tx.rollback();

    expect(store.getBusinessRows('orders')).toHaveLength(0);
    expect(store.listUnpublished()).toHaveLength(0);
  });

  it('crashBeforeCommit loses both business and outbox writes', () => {
    const store = new InMemoryTransactionalStore();
    const tx = store.begin();
    tx.writeBusiness('orders', { id: 3 });
    tx.insertOutbox({
      topic: 'orders',
      key: 'orders+3',
      payload: { id: 3 },
      principal: 'user',
      tenantId: 't1',
      traceId: randomUUID(),
    });
    tx.crashBeforeCommit();

    expect(store.getBusinessRows('orders')).toHaveLength(0);
    expect(store.listUnpublished()).toHaveLength(0);
  });
});
