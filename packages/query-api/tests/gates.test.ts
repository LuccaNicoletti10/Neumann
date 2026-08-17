/**
 * query-api — tests/gates.test.ts
 * Gate Passo 29: leakage = 0 nas 6 superfícies; freshness; p95.
 */
import { describe, expect, it } from 'vitest';

import type { SearchPrincipal } from 'contracts';

import { createDeterministicClock, createIdGenerator, percentile } from '../src/core/determinism.js';
import { createQueryEngine } from '../src/core/engine.js';
import { parseNaturalQuery } from '../src/core/nl-parse.js';
import { generateSearchTemplate } from '../src/core/templates.js';

const SECRET = 'LEAK-TOKEN-SECRETCO';
const alice: SearchPrincipal = { id: 'alice', groups: ['analysts'], viewingLevel: 'Confidential' };
const bob: SearchPrincipal = { id: 'bob', groups: ['analysts'], viewingLevel: 'Unclassified' };

function seed() {
  const engine = createQueryEngine({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
  engine.upsert({
    id: 'obj-c1',
    objectTypeId: 'ot.customer',
    primaryKey: 'C1',
    properties: { name: 'Acme', status: 'active', hidden: SECRET },
    aclPrincipals: ['alice', 'bob', 'analysts'],
    classification: 'Unclassified',
    propertyClassifications: { hidden: 'Confidential' },
    sourceUpdatedAt: '2024-06-01T11:59:00.000Z',
  });
  engine.upsert({
    id: 'obj-c2',
    objectTypeId: 'ot.customer',
    primaryKey: 'C2',
    properties: { name: 'SecretCo', status: 'vip' },
    aclPrincipals: ['alice'],
    classification: 'Confidential',
    sourceUpdatedAt: '2024-06-01T11:59:30.000Z',
  });
  engine.upsert({
    id: 'obj-so1',
    objectTypeId: 'ot.sales_order',
    primaryKey: 'SO-1',
    properties: { name: 'Order Acme', status: 'open' },
    aclPrincipals: ['alice', 'bob', 'analysts'],
    classification: 'Unclassified',
    sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
  });
  engine.upsert({
    id: 'obj-n1',
    objectTypeId: 'ot.internal_note',
    primaryKey: 'N1',
    properties: { name: 'Watchlist', body: SECRET },
    aclPrincipals: ['alice'],
    classification: 'Confidential',
    sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
  });
  engine.upsertLink({
    linkTypeId: 'lt.placed',
    sourceObjectId: 'obj-c1',
    targetObjectId: 'obj-so1',
  });
  engine.upsertLink({
    linkTypeId: 'lt.noted',
    sourceObjectId: 'obj-c1',
    targetObjectId: 'obj-n1',
  });
  return engine;
}

function dump(v: unknown): string {
  return JSON.stringify(v);
}

describe('Passo 29 — query-api gates', () => {
  it('permission leakage = 0 nas 6 superfícies', () => {
    const engine = seed();
    const bobResp = engine.execute(
      { q: 'acme', facetFields: ['name', 'status'], limit: 20 },
      bob,
    );
    const bobSecretQ = engine.execute({ q: SECRET, facetFields: ['name'] }, bob);
    const bobHidden = engine.execute({ q: SECRET }, bob);
    const around = engine.execute({ searchAround: { objectId: 'obj-c1' } }, bob);
    const phrases = engine.keyPhrases(bob);

    const blob = dump({ bobResp, bobSecretQ, around, phrases });
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain('SecretCo');

    expect(bobResp.hits.every((h) => h.primaryKey === 'C1' || h.primaryKey === 'SO-1')).toBe(true);
    expect(bobResp.hits.some((h) => h.properties['hidden'])).toBe(false);
    expect(bobSecretQ.hits).toHaveLength(0);
    expect(bobHidden.hits).toHaveLength(0);
    expect(around.hits.map((h) => h.primaryKey)).toEqual(['SO-1']);
    expect(around.metadata.backend).toBe('graph');

    expect(bobResp.facets.every((f) => f.values.every((v) => v.value !== 'SecretCo'))).toBe(true);
    expect(bobResp.autocomplete.every((s) => !s.text.includes('SecretCo'))).toBe(true);
    expect(bobResp.suggestions.every((s) => !s.text.includes('SecretCo'))).toBe(true);
    expect(bobResp.hits.every((h) => !String(h.snippet ?? '').includes(SECRET))).toBe(true);
  });

  it('Alice Confidential vê SecretCo e a nota no Search Around', () => {
    const engine = seed();
    const hits = engine.execute({ q: 'SecretCo' }, alice);
    expect(hits.hits.map((h) => h.primaryKey)).toEqual(['C2']);
    const around = engine.execute({ searchAround: { objectId: 'obj-c1' } }, alice);
    expect(around.hits.map((h) => h.primaryKey).sort()).toEqual(['N1', 'SO-1']);
    expect(engine.execute({ q: SECRET }, alice).hits.length).toBeGreaterThan(0);
  });

  it('fail-closed: documento sem ACL não aparece', () => {
    const engine = seed();
    engine.upsert({
      id: 'obj-orphan',
      objectTypeId: 'ot.customer',
      primaryKey: 'ORPH',
      properties: { name: 'Ghost' },
      aclPrincipals: [],
      classification: 'Unclassified',
      sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
    });
    const resp = engine.execute({ q: 'Ghost' }, alice);
    expect(resp.hits).toHaveLength(0);
  });

  it('template + NL parse + filter chain', () => {
    const engine = seed();
    const tpl = generateSearchTemplate('ot.sales_order', ['status']);
    engine.registerTemplate(tpl);
    const tplResp = engine.execute(
      { templateId: tpl.id, templateParams: { status: 'open' } },
      bob,
    );
    expect(tplResp.hits.map((h) => h.primaryKey)).toEqual(['SO-1']);
    const nl = parseNaturalQuery('type:ot.sales_order status=open');
    expect(nl.objectTypeIds).toEqual(['ot.sales_order']);
    expect(engine.execute(nl, bob).hits.map((h) => h.primaryKey)).toEqual(['SO-1']);
  });

  it('index freshness medido e p95 no alvo', () => {
    const engine = seed();
    const lag = engine.indexFreshnessLagMs();
    expect(lag).toBeGreaterThan(0);
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      samples.push(engine.execute({ q: 'acme' }, bob).metadata.tookMs);
    }
    expect(percentile(samples, 95)).toBeLessThanOrEqual(50);
    expect(engine.execute({ q: 'acme' }, bob).metadata.freshnessLagMs).toBeGreaterThanOrEqual(0);
  });

  it('federate roteia para backend federation', () => {
    const engine = createQueryEngine({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
      federate: () => [
        {
          id: 'P-778',
          objectTypeId: 'ot.person',
          primaryKey: 'P-778',
          properties: { name: 'Ada' },
          aclPrincipals: ['alice', 'bob', 'analysts'],
          classification: 'Unclassified',
          sourceUpdatedAt: '2024-06-01T12:00:00.000Z',
        },
      ],
    });
    const resp = engine.execute({ federate: { objectId: 'P-778' } }, bob);
    expect(resp.metadata.backend).toBe('federation');
    expect(resp.hits.map((h) => h.primaryKey)).toEqual(['P-778']);
  });
});
