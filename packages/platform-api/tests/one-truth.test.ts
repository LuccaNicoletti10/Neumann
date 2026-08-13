/**
 * platform-api — tests/one-truth.test.ts
 * GATE 1: projection/API/ObjectSet/Graph/Action share ObjectRepository.
 */

import { describe, expect, it } from 'vitest';

import { createGraphQueryEngine } from 'knowledge-graph';
import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
  createUuidIdGenerator,
  createSystemClock,
} from 'object-platform';
import { resolveObjectSet } from 'object-set';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createPlatformServer } from '../src/server.js';

describe('GATE 1 — one source of truth', () => {
  it('ObjectRepository is shared across ObjectSet, Graph, Action, /api/v2', async () => {
    const ctx = createMemoryPlatformContext();
    const ontologyId = ctx.ontology.createOntology({ name: 'shared' }).id;

    const obj = await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-1',
      properties: { status: 'open' },
    });

    // Graph sees same object
    const graph = createGraphQueryEngine({ objects: ctx.objects, links: ctx.links });
    // create peer + link
    await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.thing',
      primaryKey: 'T-2',
      properties: { status: 'open' },
    });
    await ctx.links.create({
      ontologyId,
      linkTypeId: 'lt.rel',
      sourceObjectTypeId: 'ot.thing',
      sourcePrimaryKey: 'T-1',
      targetObjectTypeId: 'ot.thing',
      targetPrimaryKey: 'T-2',
    });
    const neighbors = await graph.neighbors(ontologyId, 'ot.thing', 'T-1', {
      linkTypeId: 'lt.rel',
      direction: 'outgoing',
    });
    expect(neighbors.map((n) => n.primaryKey)).toEqual(['T-2']);

    // ObjectSet sees same object
    const set = await resolveObjectSet(
      { type: 'BASE', objectType: 'ot.thing' },
      { ontologyId, objects: ctx.objects, links: ctx.links },
    );
    expect(set.some((o) => o.id === obj.id)).toBe(true);

    // Action mutates same store
    ctx.actions.registerActionType(ontologyId, {
      id: 'act.close',
      apiName: 'close',
      displayName: 'Close',
      inputObjectTypeIds: ['ot.thing'],
      parameters: {
        id: { baseType: 'object_reference', objectTypeId: 'ot.thing', required: true },
        status: { baseType: 'string', required: true },
      },
      rules: [
        {
          kind: 'modify_object',
          objectTypeId: 'ot.thing',
          primaryKeyFromParam: 'id',
          setPropertiesFromParams: { status: 'status' },
        },
      ],
    });
    const applied = await ctx.actions.apply({
      ontologyId,
      actionApiName: 'close',
      parameters: { id: 'T-1', status: 'closed' },
      principal: 'tester',
    });
    expect(applied.status).toBe('SUCCEEDED');
    expect((await ctx.objects.get(ontologyId, 'ot.thing', 'T-1'))?.properties.status).toBe(
      'closed',
    );

    // API sees same state
    const { app } = await createPlatformServer(ctx);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v2/ontologies/${ontologyId}/objects/ot.thing/T-1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().properties.status).toBe('closed');
    await app.close();
  });
});

describe('GATE P1 — production IDs', () => {
  it('two fresh UUID generators never collide on first ids', () => {
    const a = createUuidIdGenerator();
    const b = createUuidIdGenerator();
    const ids = new Set([a('obj'), a('obj'), b('obj'), b('obj')]);
    expect(ids.size).toBe(4);
    for (const id of ids) {
      expect(id.startsWith('obj_')).toBe(true);
      expect(id).not.toMatch(/^obj-\d+$/);
    }
  });

  it('system clock advances in real time', async () => {
    const clock = createSystemClock();
    const t1 = clock();
    await new Promise((r) => setTimeout(r, 5));
    const t2 = clock();
    expect(Date.parse(t2)).toBeGreaterThanOrEqual(Date.parse(t1));
  });
});

describe('soft-delete revive', () => {
  it('recreate same PK revives identity', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const first = await objects.create({
      ontologyId: 'o',
      objectTypeId: 'ot.a',
      primaryKey: '1',
      properties: { n: 1 },
    });
    await objects.delete('o', 'ot.a', '1');
    const revived = await objects.create({
      ontologyId: 'o',
      objectTypeId: 'ot.a',
      primaryKey: '1',
      properties: { n: 2 },
    });
    expect(revived.id).toBe(first.id);
    expect(revived.version).toBe(first.version + 2); // delete + revive
    expect(revived.deleted).toBe(false);
    expect(revived.properties.n).toBe(2);
  });
});

describe('listOntologies', () => {
  it('GET /api/v2/ontologies returns created ontologies', async () => {
    const ctx = createMemoryPlatformContext();
    const o = ctx.ontology.createOntology({ name: 'alpha' });
    const { app } = await createPlatformServer(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/v2/ontologies' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((x: { id: string }) => x.id === o.id)).toBe(true);
    await app.close();
  });
});

describe('architecture boundary', () => {
  it('platform sources do not import apps or domain planner tokens', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const repoRoot = join(process.cwd(), '../..');
    const roots = [
      'packages/platform-api/src',
      'packages/object-platform/src',
      'packages/action-engine/src',
      'packages/object-set/src',
      'packages/knowledge-graph/src',
    ];
    const forbidden = [
      "from 'apps/",
      'from "apps/',
      'production_planning',
      'plan_line',
      "from 'forecast",
      "from 'netting",
    ];
    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) files.push(...(await walk(p)));
        else if (e.name.endsWith('.ts')) files.push(p);
      }
      return files;
    }
    for (const root of roots) {
      const abs = join(repoRoot, root);
      for (const file of await walk(abs)) {
        const src = await readFile(file, 'utf8');
        for (const token of forbidden) {
          expect(src.includes(token), `${file} contains ${token}`).toBe(false);
        }
      }
    }
  });
});
