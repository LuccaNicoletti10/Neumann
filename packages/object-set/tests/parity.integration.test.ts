/**
 * object-set — tests/parity.integration.test.ts
 * gate:objectset-parity — memory resolver ≡ PG SQL compiler.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ObjectSet } from 'contracts';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
  createPgLinkRepository,
  createPgObjectRepository,
  tryOpenIsolatedPg,
} from 'object-platform';

import {
  aggregateObjects,
  aggregateObjectsPg,
  loadObjects,
  loadObjectsPg,
  propertyLookupFromTypes,
  resolveObjectSet,
  resolveObjectSetPg,
} from '../src/index.js';

const db = await tryOpenIsolatedPg();

const lookup = propertyLookupFromTypes({
  status: 'string',
  n: 'number',
  sku: 'string',
});

function logical(o: { objectTypeId: string; primaryKey: string; properties: Record<string, unknown> }) {
  const p = Object.fromEntries(
    Object.entries(o.properties).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({ t: o.objectTypeId, k: o.primaryKey, p });
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!db)('gate:objectset-parity', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('memory ≡ pg on 500 seeded ASTs + keyset pages + aggregates', async () => {
    if (!db) return;
    const ontologyId = 'onto-parity';
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const memObjects = createMemoryObjectRepository({ clock, nextId });
    const memLinks = createMemoryLinkRepository({ clock, nextId });
    const pgObjects = createPgObjectRepository({ sql: db.sql });
    const pgLinks = createPgLinkRepository({ sql: db.sql });

    const statuses = ['open', 'closed', 'pending'] as const;
    for (let i = 0; i < 24; i += 1) {
      const pk = `i${String(i).padStart(2, '0')}`;
      const rec = {
        ontologyId,
        objectTypeId: 'ot.item',
        primaryKey: pk,
        properties: {
          status: statuses[i % 3]!,
          n: i,
          sku: i === 10 ? 'NIT_10%' : `SKU-${i}`,
        },
      };
      await memObjects.create(rec);
      await pgObjects.create(rec);
    }
    await memObjects.create({
      ontologyId,
      objectTypeId: 'ot.hub',
      primaryKey: 'h1',
      properties: {},
    });
    await pgObjects.create({
      ontologyId,
      objectTypeId: 'ot.hub',
      primaryKey: 'h1',
      properties: {},
    });
    for (const pk of ['i00', 'i01', 'i02', 'i10', 'i11']) {
      const edge = {
        ontologyId,
        linkTypeId: 'lt.hub-item',
        sourceObjectTypeId: 'ot.hub',
        sourcePrimaryKey: 'h1',
        targetObjectTypeId: 'ot.item',
        targetPrimaryKey: pk,
      };
      await memLinks.create(edge);
      await pgLinks.create(edge);
    }

    const memDeps = { ontologyId, objects: memObjects, links: memLinks, propertyTypes: lookup };
    const pgDeps = { sql: db.sql, ontologyId, propertyTypes: lookup };

    const rand = mulberry32(7);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

    const bases: ObjectSet[] = [
      { type: 'BASE', objectType: 'ot.item' },
      { type: 'STATIC', objectType: 'ot.item', primaryKeys: ['i00', 'i01', 'i05'] },
      { type: 'STATIC', objectType: 'ot.hub', primaryKeys: ['h1'] },
    ];

    function randomAst(depth: number): ObjectSet {
      if (depth <= 0) return pick(bases);
      const kind = Math.floor(rand() * 7);
      if (kind === 0) {
        return {
          type: 'FILTER',
          objectSet: { type: 'BASE', objectType: 'ot.item' },
          filter: pick([
            { type: 'EQUALS' as const, property: 'status', value: pick([...statuses]) },
            { type: 'NOT_EQUALS' as const, property: 'status', value: 'closed' },
            { type: 'GT' as const, property: 'n', value: Math.floor(rand() * 20) },
            { type: 'LTE' as const, property: 'n', value: Math.floor(rand() * 20) },
            { type: 'CONTAINS' as const, property: 'sku', value: 'SKU' },
            { type: 'CONTAINS' as const, property: 'sku', value: 'NIT_10%' },
            { type: 'IN_SET' as const, property: 'status', values: ['open', 'pending'] },
          ]),
        };
      }
      if (kind === 1) {
        return { type: 'UNION', objectSets: [randomAst(depth - 1), randomAst(depth - 1)] };
      }
      if (kind === 2) {
        return { type: 'INTERSECT', objectSets: [randomAst(depth - 1), randomAst(depth - 1)] };
      }
      if (kind === 3) {
        return { type: 'SUBTRACT', objectSets: [randomAst(depth - 1), randomAst(depth - 1)] };
      }
      if (kind === 4) {
        return {
          type: 'SEARCH_AROUND',
          link: 'lt.hub-item',
          objectSet: { type: 'STATIC', objectType: 'ot.hub', primaryKeys: ['h1'] },
        };
      }
      if (kind === 5) {
        return {
          type: 'FILTER',
          objectSet: randomAst(depth - 1),
          filter: { type: 'EQUALS', property: 'status', value: 'open' },
        };
      }
      return pick(bases);
    }

    for (let i = 0; i < 500; i += 1) {
      const ast = randomAst(2);
      const mem = await resolveObjectSet(ast, memDeps);
      const pg = await resolveObjectSetPg(ast, pgDeps);
      expect(pg.map(logical).sort(), `ast #${i} ${JSON.stringify(ast)}`).toEqual(
        mem.map(logical).sort(),
      );
    }

    const filterOpen: ObjectSet = {
      type: 'FILTER',
      objectSet: { type: 'BASE', objectType: 'ot.item' },
      filter: { type: 'EQUALS', property: 'status', value: 'open' },
    };
    const memPage1 = await loadObjects(
      { objectSet: filterOpen, orderBy: [{ property: 'n', direction: 'asc' }], pageSize: 3 },
      memDeps,
    );
    const pgPage1 = await loadObjectsPg(
      { objectSet: filterOpen, orderBy: [{ property: 'n', direction: 'asc' }], pageSize: 3 },
      pgDeps,
    );
    expect(pgPage1.data.map((o) => o.primaryKey)).toEqual(memPage1.data.map((o) => o.primaryKey));
    expect(pgPage1.nextPageToken).toBeTruthy();

    const pgPage2 = await loadObjectsPg(
      {
        objectSet: filterOpen,
        orderBy: [{ property: 'n', direction: 'asc' }],
        pageSize: 3,
        pageToken: pgPage1.nextPageToken,
      },
      pgDeps,
    );
    expect(pgPage2.data.map((o) => o.primaryKey)).toEqual(['i09', 'i12', 'i15']);

    const memAgg = await aggregateObjects(
      {
        objectSet: { type: 'BASE', objectType: 'ot.item' },
        aggregations: [
          { kind: 'count', name: 'n' },
          { kind: 'sum', property: 'n', name: 'sumN' },
          { kind: 'min', property: 'n', name: 'minN' },
          { kind: 'max', property: 'n', name: 'maxN' },
        ],
      },
      memDeps,
    );
    const pgAgg = await aggregateObjectsPg(
      {
        objectSet: { type: 'BASE', objectType: 'ot.item' },
        aggregations: [
          { kind: 'count', name: 'n' },
          { kind: 'sum', property: 'n', name: 'sumN' },
          { kind: 'min', property: 'n', name: 'minN' },
          { kind: 'max', property: 'n', name: 'maxN' },
        ],
      },
      pgDeps,
    );
    expect(pgAgg).toEqual(memAgg);
  });
});
