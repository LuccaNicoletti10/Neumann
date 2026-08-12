/**
 * object-set — tests/algebra.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';

import { aggregateObjects, resolveObjectSet } from '../src/index.js';

describe('ObjectSet algebra', () => {
  it('BASE FILTER UNION INTERSECT SUBTRACT STATIC SEARCH_AROUND', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const links = createMemoryLinkRepository({ clock, nextId });
    const ontologyId = 'onto-1';

    for (const [pk, status] of [
      ['a', 'open'],
      ['b', 'open'],
      ['c', 'closed'],
    ] as const) {
      await objects.create({
        ontologyId,
        objectTypeId: 'ot.item',
        primaryKey: pk,
        properties: { status, n: pk.charCodeAt(0) },
      });
    }
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.hub',
      primaryKey: 'h1',
      properties: {},
    });
    await links.create({
      ontologyId,
      linkTypeId: 'lt.hub-item',
      sourceObjectTypeId: 'ot.hub',
      sourcePrimaryKey: 'h1',
      targetObjectTypeId: 'ot.item',
      targetPrimaryKey: 'a',
    });
    await links.create({
      ontologyId,
      linkTypeId: 'lt.hub-item',
      sourceObjectTypeId: 'ot.hub',
      sourcePrimaryKey: 'h1',
      targetObjectTypeId: 'ot.item',
      targetPrimaryKey: 'b',
    });

    const deps = { ontologyId, objects, links };

    const base = await resolveObjectSet({ type: 'BASE', objectType: 'ot.item' }, deps);
    expect(base).toHaveLength(3);

    const filtered = await resolveObjectSet(
      {
        type: 'FILTER',
        filter: { type: 'EQUALS', property: 'status', value: 'open' },
        objectSet: { type: 'BASE', objectType: 'ot.item' },
      },
      deps,
    );
    expect(filtered.map((o) => o.primaryKey).sort()).toEqual(['a', 'b']);

    const uni = await resolveObjectSet(
      {
        type: 'UNION',
        objectSets: [
          { type: 'STATIC', objectType: 'ot.item', primaryKeys: ['a'] },
          { type: 'STATIC', objectType: 'ot.item', primaryKeys: ['a', 'c'] },
        ],
      },
      deps,
    );
    expect(uni).toHaveLength(2);

    const inter = await resolveObjectSet(
      {
        type: 'INTERSECT',
        objectSets: [
          { type: 'BASE', objectType: 'ot.item' },
          { type: 'STATIC', objectType: 'ot.item', primaryKeys: ['b', 'c'] },
        ],
      },
      deps,
    );
    expect(inter.map((o) => o.primaryKey).sort()).toEqual(['b', 'c']);

    const sub = await resolveObjectSet(
      {
        type: 'SUBTRACT',
        objectSets: [
          { type: 'BASE', objectType: 'ot.item' },
          { type: 'STATIC', objectType: 'ot.item', primaryKeys: ['c'] },
        ],
      },
      deps,
    );
    expect(sub.map((o) => o.primaryKey).sort()).toEqual(['a', 'b']);

    const around = await resolveObjectSet(
      {
        type: 'SEARCH_AROUND',
        link: 'lt.hub-item',
        objectSet: { type: 'STATIC', objectType: 'ot.hub', primaryKeys: ['h1'] },
      },
      deps,
    );
    expect(around.map((o) => o.primaryKey).sort()).toEqual(['a', 'b']);

    const agg = await aggregateObjects(
      {
        objectSet: { type: 'BASE', objectType: 'ot.item' },
        aggregations: [
          { kind: 'count', name: 'n' },
          { kind: 'sum', property: 'n', name: 'sumN' },
        ],
      },
      deps,
    );
    expect(agg.n).toBe(3);
    expect(agg.sumN).toBe('a'.charCodeAt(0) + 'b'.charCodeAt(0) + 'c'.charCodeAt(0));
  });
});
