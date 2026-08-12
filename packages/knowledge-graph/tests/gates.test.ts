/**
 * knowledge-graph — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { runDemo } from '../src/cli.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createKnowledgeGraph } from '../src/core/store.js';

function kg() {
  return createKnowledgeGraph({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

function seedChain() {
  const g = kg();
  g.upsertObject({ id: 'a', objectTypeId: 'ot.x', primaryKey: 'A' });
  g.upsertObject({ id: 'b', objectTypeId: 'ot.x', primaryKey: 'B' });
  g.upsertObject({ id: 'c', objectTypeId: 'ot.x', primaryKey: 'C' });
  g.upsertLink({
    linkTypeId: 'lt.p',
    sourceObjectId: 'a',
    targetObjectId: 'b',
    mappingVersionId: 'mv1',
  });
  g.upsertLink({
    linkTypeId: 'lt.p',
    sourceObjectId: 'b',
    targetObjectId: 'c',
    mappingVersionId: 'mv1',
  });
  return g;
}

describe('Passo 19 gates', () => {
  it('integridade: rejeita link com target ausente', () => {
    const g = kg();
    g.upsertObject({ id: 'a', objectTypeId: 'ot.x', primaryKey: 'A' });
    expect(() =>
      g.upsertLink({
        linkTypeId: 'lt.p',
        sourceObjectId: 'a',
        targetObjectId: 'missing',
        mappingVersionId: 'mv1',
      }),
    ).toThrow(/inexistente/);
  });

  it('traverse multi-hop A→B→C', () => {
    const g = seedChain();
    const r = g.traverseLinks({ startObjectId: 'a', maxHops: 2, linkTypeIds: ['lt.p'] });
    expect(r.maxDepthReached).toBe(2);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(r.hops).toHaveLength(2);
  });

  it('toRecursiveCteSql emite WITH RECURSIVE', () => {
    const g = seedChain();
    const sql = g.toRecursiveCteSql({ startObjectId: 'a', maxHops: 3 });
    expect(sql).toContain('WITH RECURSIVE');
    expect(sql).toContain('JOIN links');
  });

  it('link migration reescreve mapping_version + linkType', () => {
    const g = seedChain();
    const mig = g.migrateLinks({
      fromMappingVersionId: 'mv1',
      toMappingVersionId: 'mv2',
      linkTypeMap: { 'lt.p': 'lt.p2' },
    });
    expect(mig.migrated).toBe(2);
    expect(g.listLinks({ mappingVersionId: 'mv1' })).toHaveLength(0);
    expect(g.listLinks({ mappingVersionId: 'mv2' })).toHaveLength(2);
    expect(g.listLinks({ linkTypeId: 'lt.p2' })).toHaveLength(2);
  });

  it('remote reference ticket resolve + access', () => {
    const g = seedChain();
    g.upsertObject({
      id: 'c',
      objectTypeId: 'ot.x',
      primaryKey: 'C',
      properties: { label: 'gamma' },
    });
    const ref = g.createRemoteReference('c');
    expect(g.resolveRemoteReference(ref.ticketId)?.primaryKey).toBe('C');
    expect(g.accessRemote(ref.ticketId, 'label')).toBe('gamma');
    expect(g.resolveRemoteReference('nope')).toBeNull();
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
