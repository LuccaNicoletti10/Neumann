/**
 * event-bus — tests/pg-outbox-canonical.integration.test.ts
 * PostgresOutboxStore uses official outbox_events migration, not a second table.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { tryOpenIsolatedPg } from 'object-platform';

import { PostgresOutboxStore } from '../src/store/postgres-outbox.js';
import { createPgOutboxRepository } from '../src/store/pg-outbox-repository.js';
import { withOutbox } from '../src/with-outbox.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('canonical outbox_events', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('writes to outbox_events from official migrations', async () => {
    if (!db) return;
    const store = new PostgresOutboxStore(db.connectionString, { schema: db.schema });
    // Do not call init() schema create — tables already applied from infra/sql.
    const eventId = randomUUID();
    await withOutbox(store, (tx) => {
      tx.insertOutbox({
        eventId,
        topic: 'action.side_effect.writeback',
        key: 'o1+exec',
        payload: { kind: 'connector_writeback' },
        principal: 'u1',
        tenantId: 'default',
        traceId: eventId,
      });
    });

    const unpublished = await store.listUnpublished();
    expect(unpublished.some((r) => r.eventId === eventId)).toBe(true);

    const count = await db.sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM outbox_events WHERE event_id = $1`,
      [eventId],
    );
    expect(count.rows[0]?.n).toBe('1');

    const ghost = await db.sql.query(
      `SELECT to_regclass('outbox') AS name`,
    );
    expect(ghost.rows[0]?.name).toBeNull();

    await store.close();
  });

  it('Action OutboxRepository inserts into the same table', async () => {
    if (!db) return;
    const repo = createPgOutboxRepository({ sql: db.sql });
    const eventId = randomUUID();
    await repo.insert({
      eventId,
      topic: 'action.side_effect.writeback',
      key: 'o1+uow',
      payload: { ok: true },
      principal: 'u1',
      traceId: eventId,
    });
    const found = await db.sql.query(
      `SELECT topic FROM outbox_events WHERE event_id = $1`,
      [eventId],
    );
    expect(found.rows[0]?.topic).toBe('action.side_effect.writeback');
  });
});
