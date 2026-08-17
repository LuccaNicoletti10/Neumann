/**
 * knowledge-graph — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { runDemo, runRedactDemo } from '../src/cli.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { redactGraph, sanitizedContainsValue } from '../src/core/redact.js';
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

  it('Passo 26: link cruzado crm→erp; viewing Unclassified omite Confidential', () => {
    const g = kg();
    g.upsertObject({
      id: 'cust',
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      sourceSystem: 'crm',
      classification: 'Confidential',
    });
    g.upsertObject({
      id: 'ord',
      objectTypeId: 'ot.sales_order',
      primaryKey: 'SO-1',
      sourceSystem: 'erp',
      classification: 'Unclassified',
    });
    const link = g.upsertLink({
      linkTypeId: 'lt.placed',
      sourceObjectId: 'cust',
      targetObjectId: 'ord',
      mappingVersionId: 'mv1',
      sourceDatasetId: 'customers',
      targetDatasetId: 'orders',
    });
    expect(link.sourceDatasetId).toBe('customers');
    expect(g.getObject('cust')?.sourceSystem).toBe('crm');

    const alice = g.traverseLinks({
      startObjectId: 'cust',
      maxHops: 1,
      viewingLevel: 'Confidential',
    });
    const bob = g.traverseLinks({
      startObjectId: 'cust',
      maxHops: 1,
      viewingLevel: 'Unclassified',
    });
    expect(alice.hops).toHaveLength(1);
    expect(bob.nodes).toHaveLength(0);
  });

  it('Passo 27: redaction strip property + drop node + repair dangling; no leak', () => {
    const secret = 'c1@internal.example';
    const g = kg();
    g.upsertObject({
      id: 'c1',
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      classification: 'Unclassified',
      properties: { name: 'Acme', email: secret },
      propertyClassifications: { email: 'Confidential' },
    });
    g.upsertObject({
      id: 'so1',
      objectTypeId: 'ot.sales_order',
      primaryKey: 'SO-1',
      classification: 'Unclassified',
      properties: { amount: 10 },
    });
    g.upsertObject({
      id: 'note',
      objectTypeId: 'ot.internal_note',
      primaryKey: 'N1',
      classification: 'Confidential',
      properties: { text: 'internal' },
    });
    g.upsertLink({
      id: 'placed',
      linkTypeId: 'lt.placed',
      sourceObjectId: 'c1',
      targetObjectId: 'so1',
      mappingVersionId: 'mv1',
    });
    g.upsertLink({
      id: 'annotated',
      linkTypeId: 'lt.annotated',
      sourceObjectId: 'c1',
      targetObjectId: 'note',
      mappingVersionId: 'mv1',
    });

    const bob = redactGraph(g.listObjects(), g.listLinks(), { viewingLevel: 'Unclassified' });
    const ids = new Set(bob.nodes.map((n) => n.id));
    expect(ids.has('note')).toBe(false);
    expect(bob.nodes.find((n) => n.id === 'c1')?.properties).not.toHaveProperty('email');
    expect(bob.nodes.find((n) => n.id === 'c1')?.properties).toHaveProperty('name');
    expect(bob.links.map((l) => l.id)).toEqual(['placed']);
    expect(bob.links.every((l) => ids.has(l.sourceObjectId) && ids.has(l.targetObjectId))).toBe(
      true,
    );
    expect(sanitizedContainsValue(bob, secret)).toBe(false);
    expect(g.getObject('c1')?.properties?.email).toBe(secret);

    const alice = redactGraph(g.listObjects(), g.listLinks(), { viewingLevel: 'Confidential' });
    expect(alice.nodes).toHaveLength(3);
    expect(alice.nodes.find((n) => n.id === 'c1')?.properties?.email).toBe(secret);
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });

  it('Passo 27 redact demo exit 0', () => {
    const lines: string[] = [];
    expect(runRedactDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('redact ok'))).toBe(true);
  });
});
