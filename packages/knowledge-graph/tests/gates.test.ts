/**
 * knowledge-graph — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { runDemo, runMain, runRedactDemo } from '../src/cli.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { redactGraph, sanitizedContainsValue } from '../src/core/redact.js';
import { createKnowledgeGraph } from '../src/core/store.js';

function kg() {
  return createKnowledgeGraph({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

async function seedChain() {
  const g = kg();
  await g.upsertObject({ id: 'a', objectTypeId: 'ot.x', primaryKey: 'A' });
  await g.upsertObject({ id: 'b', objectTypeId: 'ot.x', primaryKey: 'B' });
  await g.upsertObject({ id: 'c', objectTypeId: 'ot.x', primaryKey: 'C' });
  await g.upsertLink({
    linkTypeId: 'lt.p',
    sourceObjectId: 'a',
    targetObjectId: 'b',
    mappingVersionId: 'mv1',
  });
  await g.upsertLink({
    linkTypeId: 'lt.p',
    sourceObjectId: 'b',
    targetObjectId: 'c',
    mappingVersionId: 'mv1',
  });
  return g;
}

describe('Passo 19 gates', () => {
  it('integridade: rejeita link com target ausente', async () => {
    const g = kg();
    await g.upsertObject({ id: 'a', objectTypeId: 'ot.x', primaryKey: 'A' });
    await expect(
      g.upsertLink({
        linkTypeId: 'lt.p',
        sourceObjectId: 'a',
        targetObjectId: 'missing',
        mappingVersionId: 'mv1',
      }),
    ).rejects.toThrow(/inexistente/);
  });

  it('traverse multi-hop A→B→C', async () => {
    const g = await seedChain();
    const r = await g.traverseLinks({ startObjectId: 'a', maxHops: 2, linkTypeIds: ['lt.p'] });
    expect(r.maxDepthReached).toBe(2);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(r.hops).toHaveLength(2);
  });

  it('toRecursiveCteSql emite WITH RECURSIVE', async () => {
    const g = await seedChain();
    const sql = g.toRecursiveCteSql({ startObjectId: 'a', maxHops: 3 });
    expect(sql).toContain('WITH RECURSIVE');
    expect(sql).toContain('JOIN links');
  });

  it('link migration reescreve mapping_version + linkType', async () => {
    const g = await seedChain();
    const mig = await g.migrateLinks({
      fromMappingVersionId: 'mv1',
      toMappingVersionId: 'mv2',
      linkTypeMap: { 'lt.p': 'lt.p2' },
    });
    expect(mig.migrated).toBe(2);
    expect(await g.listLinks({ mappingVersionId: 'mv1' })).toHaveLength(0);
    expect(await g.listLinks({ mappingVersionId: 'mv2' })).toHaveLength(2);
    expect(await g.listLinks({ linkTypeId: 'lt.p2' })).toHaveLength(2);
  });

  it('getLink resolves an edge by id and does not invent one', async () => {
    const g = await seedChain();
    const [first] = await g.listLinks({ linkTypeId: 'lt.p' });
    const found = await g.getLink(first!.id);
    expect(found?.id).toBe(first!.id);
    expect(found?.sourceObjectId).toBe(first!.sourceObjectId);
    expect(await g.getLink('link-does-not-exist')).toBeUndefined();
  });

  it('remote reference ticket resolve + access', async () => {
    const g = await seedChain();
    await g.upsertObject({
      id: 'c',
      objectTypeId: 'ot.x',
      primaryKey: 'C',
      properties: { label: 'gamma' },
    });
    const ref = await g.createRemoteReference('c');
    expect((await g.resolveRemoteReference(ref.ticketId))?.primaryKey).toBe('C');
    expect(await g.accessRemote(ref.ticketId, 'label')).toBe('gamma');
    expect(await g.resolveRemoteReference('nope')).toBeNull();
  });

  it('Passo 26: link cruzado crm→erp; viewing Unclassified omite Confidential', async () => {
    const g = kg();
    await g.upsertObject({
      id: 'cust',
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      sourceSystem: 'crm',
      classification: 'Confidential',
    });
    await g.upsertObject({
      id: 'ord',
      objectTypeId: 'ot.sales_order',
      primaryKey: 'SO-1',
      sourceSystem: 'erp',
      classification: 'Unclassified',
    });
    const link = await g.upsertLink({
      linkTypeId: 'lt.placed',
      sourceObjectId: 'cust',
      targetObjectId: 'ord',
      mappingVersionId: 'mv1',
      sourceDatasetId: 'customers',
      targetDatasetId: 'orders',
    });
    expect(link.sourceDatasetId).toBe('customers');
    expect((await g.getObject('cust'))?.sourceSystem).toBe('crm');

    const alice = await g.traverseLinks({
      startObjectId: 'cust',
      maxHops: 1,
      viewingLevel: 'Confidential',
    });
    const bob = await g.traverseLinks({
      startObjectId: 'cust',
      maxHops: 1,
      viewingLevel: 'Unclassified',
    });
    expect(alice.hops).toHaveLength(1);
    expect(bob.nodes).toHaveLength(0);
  });

  it('Passo 27: redaction strip property + drop node + repair dangling; no leak', async () => {
    const secret = 'c1@internal.example';
    const g = kg();
    await g.upsertObject({
      id: 'c1',
      objectTypeId: 'ot.customer',
      primaryKey: 'C1',
      classification: 'Unclassified',
      properties: { name: 'Acme', email: secret },
      propertyClassifications: { email: 'Confidential' },
    });
    await g.upsertObject({
      id: 'so1',
      objectTypeId: 'ot.sales_order',
      primaryKey: 'SO-1',
      classification: 'Unclassified',
      properties: { amount: 10 },
    });
    await g.upsertObject({
      id: 'note',
      objectTypeId: 'ot.internal_note',
      primaryKey: 'N1',
      classification: 'Confidential',
      properties: { text: 'internal' },
    });
    await g.upsertLink({
      id: 'placed',
      linkTypeId: 'lt.placed',
      sourceObjectId: 'c1',
      targetObjectId: 'so1',
      mappingVersionId: 'mv1',
    });
    await g.upsertLink({
      id: 'annotated',
      linkTypeId: 'lt.annotated',
      sourceObjectId: 'c1',
      targetObjectId: 'note',
      mappingVersionId: 'mv1',
    });

    const bob = redactGraph(await g.listObjects(), await g.listLinks(), {
      viewingLevel: 'Unclassified',
    });
    const ids = new Set(bob.nodes.map((n) => n.id));
    expect(ids.has('note')).toBe(false);
    expect(bob.nodes.find((n) => n.id === 'c1')?.properties).not.toHaveProperty('email');
    expect(bob.nodes.find((n) => n.id === 'c1')?.properties).toHaveProperty('name');
    expect(bob.links.map((l) => l.id)).toEqual(['placed']);
    expect(bob.links.every((l) => ids.has(l.sourceObjectId) && ids.has(l.targetObjectId))).toBe(
      true,
    );
    expect(sanitizedContainsValue(bob, secret)).toBe(false);
    expect((await g.getObject('c1'))?.properties?.email).toBe(secret);

    const alice = redactGraph(await g.listObjects(), await g.listLinks(), {
      viewingLevel: 'Confidential',
    });
    expect(alice.nodes).toHaveLength(3);
    expect(alice.nodes.find((n) => n.id === 'c1')?.properties?.email).toBe(secret);
  });

  it('cli demo exit 0', async () => {
    const lines: string[] = [];
    expect(await runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });

  it('runMain reports the command exit code through process.exitCode', async () => {
    const before = process.exitCode;
    try {
      await runMain(['help']);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = before;
    }
  });

  it('Passo 27 redact demo exit 0', async () => {
    const lines: string[] = [];
    expect(runRedactDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('redact ok'))).toBe(true);
  });
});
