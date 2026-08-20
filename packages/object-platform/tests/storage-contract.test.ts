/**
 * object-platform — tests/storage-contract.test.ts
 * Memory adapter of the ADR-0007 contract suite.
 */
import type { ObjectRepository } from 'contracts';
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createMemoryLinkRepository } from '../src/core/link-repository.js';
import { createSnapshotUnitOfWork } from '../src/core/memory-transaction-boundary.js';
import { createMemoryObjectHistoryStore } from '../src/core/object-history-store.js';
import { createMemoryObjectRepository } from '../src/core/object-repository.js';
import { createObjectPlatform } from '../src/core/platform.js';

import { runStorageContract } from './storage-contract.js';

describe('storage contract — memory', () => {
  it('matches the canonical object/link suite', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const history = createMemoryObjectHistoryStore({ clock, nextId });
    const links = createMemoryLinkRepository({
      clock,
      nextId,
      objectExists: async (oid, t, pk) => Boolean(await objects.get(oid, t, pk)),
    });
    const uow = createSnapshotUnitOfWork(
      [objects, links, history],
      () => ({ objects, links, history }),
    );
    await runStorageContract({
      objects,
      links,
      history,
      ontologyId: 'o-mem',
      uow: (fn) => uow.run(fn),
    });
  });

  // WHY: ADR-0013 — the facade is async, so a PG-shaped (deferred) repository is a
  // first-class caller. Proof 23/24: the facade decides before it writes, so a deny
  // leaves no ghost write and never throws after an async write has started.
  it('async repository through the async facade never ghost-writes', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    const writes: string[] = [];
    const deferred: ObjectRepository = {
      create: async (input) => {
        writes.push('create');
        await Promise.resolve();
        return inner.create(input);
      },
      get: async (o, t, pk) => {
        await Promise.resolve();
        return inner.get(o, t, pk);
      },
      getById: async (id) => {
        await Promise.resolve();
        return inner.getById(id);
      },
      list: async (o, t, opts) => {
        await Promise.resolve();
        return inner.list(o, t, opts);
      },
      listAll: async (o, opts) => {
        await Promise.resolve();
        return inner.listAll(o, opts);
      },
      update: async (o, t, pk, input) => {
        writes.push('update');
        await Promise.resolve();
        return inner.update(o, t, pk, input);
      },
      delete: async (o, t, pk, input) => {
        writes.push('delete');
        await Promise.resolve();
        return inner.delete(o, t, pk, input);
      },
    };

    let allow = true;
    const p = createObjectPlatform({
      clock,
      nextId,
      objects: deferred,
      authorize: () => ({
        decision: allow ? 'allow' : 'deny',
        principalEpids: [],
        resourceEpid: null,
        reason: 'test',
      }),
    });
    const m = p.createMapping({
      name: 'm',
      datasetId: 'ds',
      objectTypeId: 'ot.a',
      ontologyVersionId: 'ov-1',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'n', propertyTypeId: 'pt.n', transform: 'string' }],
    });
    const mv = p.getLatestMappingVersion(m.id)!;

    const proj = await p.project({
      mappingVersionId: mv.id,
      datasetVersionId: 'dv-1',
      rows: [{ fields: { id: '1', n: 'x' } }],
    });
    expect(proj.upserted).toBe(1);
    expect(writes).toEqual(['create']);

    const objectId = proj.objectIds[0]!;
    const before = await p.getObject('alice', objectId);
    expect(before?.properties['pt.n']).toBe('x');

    allow = false;
    const rejected = p.applyUserEdit(objectId, { 'pt.n': 'ghost' }, 'alice');
    expect(rejected).toBeInstanceOf(Promise);
    await expect(rejected).rejects.toThrow(/authorize deny modify/);

    // No write reached the repository, so there is nothing to roll back.
    expect(writes).toEqual(['create']);
    allow = true;
    const after = await p.getObject('alice', objectId);
    expect(after?.properties['pt.n']).toBe('x');
    expect(after?.version).toBe(before?.version);
  });
});
