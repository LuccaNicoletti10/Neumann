/**
 * ingestion-runtime — worker loop is abortable.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryCheckpointStore } from 'connector-sdk';

import {
  createConnectorRegistry,
  createIngestionRuntime,
  createIngestionWorker,
  createMemoryIngestionStore,
  sourceFromEnvelopes,
} from '../src/index.js';
import { allow, makeHarness } from './harness.js';

describe('IngestionWorker', () => {
  it('drains work, stops on abort, and resumes after restart', async () => {
    const source = sourceFromEnvelopes('csv', [
      {
        connectorId: 'csv',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't0',
        payload: { id: '1', name: 'alpha' },
        metadata: { checkpoint: '1' },
      },
    ]);
    const h = await makeHarness({ sources: [source] });
    const store = createMemoryIngestionStore();
    const runtime = createIngestionRuntime({
      projections: h.writer,
      catalog: {
        getVersion: async (id) => h.platform.getMappingVersion(id),
        getLatest: async (id) => h.platform.getLatestMappingVersion(id),
      },
      connectors: createConnectorRegistry([source]),
      store,
      checkpoints: createMemoryCheckpointStore(),
      authorize: allow,
      resourceId: 'admin:ingest',
      clock: () => '2024-01-01T00:00:00.000Z',
      nextId: h.nextId,
    });
    await runtime.startPull({
      connectorId: 'csv',
      mappingId: h.mapping.id,
      ontologyId: h.ontologyId,
      principal: 'svc',
    });
    const worker = createIngestionWorker({
      runtime,
      store,
      clock: () => '2024-01-01T00:00:00.000Z',
      pollIntervalMs: 5,
      backoffMs: [5, 5],
    });
    const ac = new AbortController();
    const running = worker.run(ac.signal);
    await worker.drainOnce();
    ac.abort();
    await worker.stop();
    await running;
    expect((await h.objects.get(h.ontologyId, 'ot.item', '1'))?.properties['pt.name']).toBe(
      'alpha',
    );
    const worker2 = createIngestionWorker({
      runtime,
      store,
      clock: () => '2024-01-01T00:00:00.000Z',
    });
    await worker2.drainOnce();
  });
});
