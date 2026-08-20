/**
 * knowledge-graph — tests/shared-kernel.test.ts
 * Graph facade and ObjectPlatform share repositories; no copy to sync.
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectHistoryStore,
  createMemoryObjectRepository,
  createObjectPlatform,
} from 'object-platform';

import { createKnowledgeGraph } from '../src/core/store.js';

describe('shared storage kernel', () => {
  it('platform project is visible to the graph without copying objects', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const history = createMemoryObjectHistoryStore({ clock, nextId });
    const links = createMemoryLinkRepository({
      clock,
      nextId,
      objectExists: async (oid, t, pk) => Boolean(await objects.get(oid, t, pk)),
    });
    const ontologyId = 'shared';
    const platform = createObjectPlatform({
      clock,
      nextId,
      objects,
      links,
      history,
      ontologyId,
      authorize: () => ({
        decision: 'allow',
        principalEpids: [],
        resourceEpid: null,
        reason: 'ok',
      }),
    });
    const graph = createKnowledgeGraph({
      clock,
      nextId,
      objects,
      links,
      ontologyId,
      objectTypeIds: ['ot.a'],
    });
    const m = platform.createMapping({
      name: 'm',
      datasetId: 'ds',
      objectTypeId: 'ot.a',
      ontologyVersionId: 'ov-1',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'n', propertyTypeId: 'pt.n', transform: 'string' }],
    });
    const mv = platform.getLatestMappingVersion(m.id)!;
    const projected = await platform.project({
      mappingVersionId: mv.id,
      datasetVersionId: 'dv-1',
      rows: [{ fields: { id: '1', n: 'x' } }],
    });
    const fromPlatform = await platform.getObject('alice', projected.objectIds[0]!);
    const fromGraph = await graph.getObject(projected.objectIds[0]!);
    expect(fromPlatform?.id).toBe(fromGraph?.id);
    expect(fromGraph?.primaryKey).toBe('1');
    expect((await objects.get(ontologyId, 'ot.a', '1'))?.id).toBe(fromPlatform?.id);
  });
});
