/**
 * knowledge-graph — tests/graph-query.test.ts
 * GraphQueryEngine is PlatformContext.graph: a read over the canonical
 * repositories. It owns no state and must not invent nodes or edges.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';

import { createGraphQueryEngine, type GraphQueryEngine } from '../src/core/graph-query.js';

const ONTOLOGY = 'kg-read';

async function harness(): Promise<{
  graph: GraphQueryEngine;
  objects: ReturnType<typeof createMemoryObjectRepository>;
  links: ReturnType<typeof createMemoryLinkRepository>;
}> {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const objects = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({
    clock,
    nextId,
    objectExists: async (oid, t, pk) => Boolean(await objects.get(oid, t, pk)),
  });
  for (const pk of ['a', 'b', 'c', 'd']) {
    await objects.create({
      ontologyId: ONTOLOGY,
      objectTypeId: 'ot.node',
      primaryKey: pk,
      properties: { 'pt.label': pk },
    });
  }
  return { graph: createGraphQueryEngine({ objects, links }), objects, links };
}

async function link(
  links: ReturnType<typeof createMemoryLinkRepository>,
  linkTypeId: string,
  from: string,
  to: string,
): Promise<void> {
  await links.create({
    ontologyId: ONTOLOGY,
    linkTypeId,
    sourceObjectTypeId: 'ot.node',
    sourcePrimaryKey: from,
    targetObjectTypeId: 'ot.node',
    targetPrimaryKey: to,
  });
}

describe('GraphQueryEngine over canonical repositories', () => {
  let h: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    h = await harness();
  });

  it('neighbors honours direction and never crosses it', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.next', 'c', 'a');

    const out = await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', { direction: 'outgoing' });
    const incoming = await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', { direction: 'incoming' });
    const both = await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', { direction: 'both' });

    expect(out.map((o) => o.primaryKey)).toEqual(['b']);
    expect(incoming.map((o) => o.primaryKey)).toEqual(['c']);
    expect(both.map((o) => o.primaryKey).sort()).toEqual(['b', 'c']);
  });

  it('neighbors defaults to outgoing and filters by link type', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.other', 'a', 'c');

    expect((await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a')).map((o) => o.primaryKey)).toEqual([
      'b',
      'c',
    ]);
    const filtered = await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', { linkTypeId: 'lt.next' });
    expect(filtered.map((o) => o.primaryKey)).toEqual(['b']);
  });

  it('neighbors deduplicates parallel edges to the same endpoint', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.other', 'a', 'b');

    expect((await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a')).map((o) => o.primaryKey)).toEqual([
      'b',
    ]);
  });

  it('neighbors skips an endpoint that no longer resolves', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.next', 'b', 'a');
    await h.objects.delete(ONTOLOGY, 'ot.node', 'b');

    expect(await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', { direction: 'both' })).toEqual([]);
  });

  it('searchAround unions neighbors of every source without duplicates', async () => {
    await link(h.links, 'lt.next', 'a', 'c');
    await link(h.links, 'lt.next', 'b', 'c');
    await link(h.links, 'lt.next', 'b', 'd');
    const sources = [
      (await h.objects.get(ONTOLOGY, 'ot.node', 'a'))!,
      (await h.objects.get(ONTOLOGY, 'ot.node', 'b'))!,
    ];

    const found = await h.graph.searchAround(ONTOLOGY, sources, 'lt.next');
    expect(found.map((o) => o.primaryKey)).toEqual(['c', 'd']);
  });

  it('traverse stops at maxHops and reports the depth actually reached', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.next', 'b', 'c');
    await link(h.links, 'lt.next', 'c', 'd');

    const one = await h.graph.traverse(ONTOLOGY, {
      startObjectId: 'ignored',
      startObjectTypeId: 'ot.node',
      startPrimaryKey: 'a',
      maxHops: 1,
    });
    expect(one.nodes.map((n) => n.primaryKey)).toEqual(['a', 'b']);
    expect(one.maxDepthReached).toBe(1);

    const three = await h.graph.traverse(ONTOLOGY, {
      startObjectId: 'ignored',
      startObjectTypeId: 'ot.node',
      startPrimaryKey: 'a',
      maxHops: 3,
    });
    expect(three.nodes.map((n) => n.primaryKey)).toEqual(['a', 'b', 'c', 'd']);
    expect(three.maxDepthReached).toBe(3);
  });

  it('traverse restricted to declared link types ignores other edges', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.other', 'a', 'c');

    const result = await h.graph.traverse(ONTOLOGY, {
      startObjectId: 'ignored',
      startObjectTypeId: 'ot.node',
      startPrimaryKey: 'a',
      maxHops: 2,
      linkTypeIds: ['lt.next'],
    });
    expect(result.nodes.map((n) => n.primaryKey)).toEqual(['a', 'b']);
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0]?.viaLinkTypeId).toBe('lt.next');
  });

  it('traverse with uniqueNodes false still terminates on a cycle', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.next', 'b', 'a');

    const result = await h.graph.traverse(ONTOLOGY, {
      startObjectId: 'ignored',
      startObjectTypeId: 'ot.node',
      startPrimaryKey: 'a',
      maxHops: 3,
      uniqueNodes: false,
    });
    expect(result.maxDepthReached).toBe(3);
    expect(result.hops).toHaveLength(3);
  });

  it('traverse from an absent start returns nothing instead of inventing a node', async () => {
    const result = await h.graph.traverse(ONTOLOGY, {
      startObjectId: 'ghost',
      startObjectTypeId: 'ot.node',
      startPrimaryKey: 'missing',
      maxHops: 2,
    });
    expect(result).toEqual({
      startObjectId: 'ghost',
      nodes: [],
      hops: [],
      maxDepthReached: 0,
    });
  });

  it('checkIntegrity reports dangling live links and non-zero counts', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await h.objects.delete(ONTOLOGY, 'ot.node', 'b', { expectedVersion: 1 });
    const report = await h.graph.checkIntegrity(ONTOLOGY);
    expect(report.ok).toBe(false);
    expect(report.objectCount).toBeGreaterThan(0);
    expect(report.linkCount).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.kind === 'dangling_target')).toBe(true);
  });

  it('checkIntegrity reports over the repositories, not over an internal index', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    const report = await h.graph.checkIntegrity(ONTOLOGY);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.objectCount).toBeGreaterThan(0);
    expect(report.linkCount).toBeGreaterThan(0);
  });

  it('neighbors filters multiple linkTypeIds', async () => {
    await link(h.links, 'lt.next', 'a', 'b');
    await link(h.links, 'lt.other', 'a', 'c');
    const onlyNext = await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', {
      linkTypeIds: ['lt.next'],
    });
    const both = await h.graph.neighbors(ONTOLOGY, 'ot.node', 'a', {
      linkTypeIds: ['lt.next', 'lt.other'],
    });
    expect(onlyNext.map((o) => o.primaryKey)).toEqual(['b']);
    expect(both.map((o) => o.primaryKey).sort()).toEqual(['b', 'c']);
  });
});
