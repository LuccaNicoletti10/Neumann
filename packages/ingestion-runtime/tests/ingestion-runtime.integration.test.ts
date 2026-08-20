/**
 * ingestion-runtime — PostgreSQL run/checkpoint/quarantine survive reconnect.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { createUuidIdGenerator, tryOpenIsolatedPg } from 'object-platform';

import {
  catalogFromPlatform,
  createConnectorRegistry,
  createIngestionRuntime,
  createPgCheckpointStore,
  createPgIngestionStore,
  sourceFromEnvelopes,
} from '../src/index.js';
import { allow, makeHarness } from './harness.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('IngestionRuntime PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('restart preserves the mapping pin, checkpoint and quarantine', async () => {
    if (!db) return;
    const h = await makeHarness({
      sources: [
        sourceFromEnvelopes('csv', [
          {
            connectorId: 'csv',
            source: 'file',
            sourceEventId: 'ok-1',
            occurredAt: 't0',
            payload: { id: '1', name: 'pg' },
            metadata: { checkpoint: '1' },
          },
          {
            connectorId: 'csv',
            source: 'file',
            sourceEventId: 'bad-1',
            occurredAt: 't0',
            payload: { name: 'no-pk' },
            metadata: {},
          },
        ]),
      ],
    });
    const store = createPgIngestionStore({ sql: db.sql });
    const checkpoints = createPgCheckpointStore({ sql: db.sql });
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: catalogFromPlatform(h.platform),
      connectors: createConnectorRegistry([
        sourceFromEnvelopes('csv', [
          {
            connectorId: 'csv',
            source: 'file',
            sourceEventId: 'ok-1',
            occurredAt: 't0',
            payload: { id: '1', name: 'pg' },
            metadata: { checkpoint: '1' },
          },
          {
            connectorId: 'csv',
            source: 'file',
            sourceEventId: 'bad-1',
            occurredAt: 't0',
            payload: { name: 'no-pk' },
            metadata: {},
          },
        ]),
      ]),
      store,
      checkpoints,
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: h.clock,
      nextId: h.nextId,
    });
    const run = await runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const pin = run.pin.mappingVersionId;
    await runtime.runOnce(run.id);

    const sql = db.reconnect();
    const reopened = createPgIngestionStore({ sql });
    const after = await reopened.getRun(run.id);
    expect(after?.pin.mappingVersionId).toBe(pin);
    expect(after?.processedCount).toBe(1);
    expect(after?.quarantinedCount).toBe(1);
    const [quarantined] = await reopened.listQuarantine(run.id);
    expect(quarantined?.pin.mappingVersionId).toBe(pin);
    const cursor = await createPgCheckpointStore({ sql }).get('csv', 'default');
    expect(cursor?.token).toBe('1');
  });

  it('duplicate quarantine is one row; expired lease is resumed; HTTP pages resume', async () => {
    if (!db) return;
    const h = await makeHarness();
    const store = createPgIngestionStore({ sql: db.sql });
    const envelope = {
      connectorId: 'csv',
      source: 'file',
      sourceEventId: 'q1',
      occurredAt: 't0',
      payload: { name: 'no-pk' },
      metadata: {},
    };
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: catalogFromPlatform(h.platform),
      connectors: createConnectorRegistry([]),
      store,
      checkpoints: createPgCheckpointStore({ sql: db.sql }),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: h.clock,
      nextId: createUuidIdGenerator(),
    });
    const run = await runtime.enqueueWebhook({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
      envelope,
    });
    await runtime.runOnce(run.id);
    const first = await store.listQuarantine(run.id);
    expect(first).toHaveLength(1);
    await store.insertQuarantine(first[0]!);
    expect(await store.listQuarantine(run.id)).toHaveLength(1);

    const source = sourceFromEnvelopes('http', [
      {
        connectorId: 'http',
        source: 'http',
        sourceEventId: 'h1',
        occurredAt: 't0',
        payload: { id: 'h1', name: 'page-1' },
        metadata: { checkpoint: '1' },
      },
      {
        connectorId: 'http',
        source: 'http',
        sourceEventId: 'h2',
        occurredAt: 't0',
        payload: { id: 'h2', name: 'page-2' },
        metadata: { checkpoint: '2' },
      },
    ]);
    const paged = createIngestionRuntime({
      projections: h.writer,
      catalog: catalogFromPlatform(h.platform),
      connectors: createConnectorRegistry([source]),
      store,
      checkpoints: createPgCheckpointStore({ sql: db.sql }),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: h.clock,
      nextId: createUuidIdGenerator(),
      pageSize: 1,
    });
    const pull = await paged.startPull({
      connectorId: 'http',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    await store.acquireLease({
      runId: pull.id,
      workerId: 'expired',
      leaseUntil: '2000-01-01T00:00:00.000Z',
      now: '2000-01-01T00:00:00.000Z',
    });
    await paged.runOnce(pull.id);
    expect((await h.objects.get(h.ontologyId, 'ot.item', 'h1'))?.properties['pt.name']).toBe(
      'page-1',
    );
    await paged.runOnce(pull.id);
    expect((await h.objects.get(h.ontologyId, 'ot.item', 'h2'))?.properties['pt.name']).toBe(
      'page-2',
    );
  });
});
