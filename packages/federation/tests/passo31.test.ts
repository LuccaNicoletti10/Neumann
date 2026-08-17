/**
 * federation — tests/passo31.test.ts
 * Gate T1.5 + US 10,402,397 / 11,281,659 / 11,681,690.
 */
import { describe, expect, it } from 'vitest';

import type { FederationPrincipal } from 'contracts';

import { runDemo } from '../src/cli.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createFederateAdapter } from '../src/core/search-adapter.js';
import { FED_SSN_SECRET, seedFederation } from '../src/core/seed.js';
import { planFederation } from '../src/core/planner.js';

const alice: FederationPrincipal = { id: 'alice', groups: ['analysts'] };
const bob: FederationPrincipal = { id: 'bob', groups: ['analysts'] };

describe('Passo 31 — federation / T1.5', () => {
  it('CLI demo exit 0 e sem leak de SSN', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
    expect(lines.join('\n')).not.toContain(FED_SSN_SECRET);
  });

  it('T1.5: consulta remota sem copiar (sem snapshot, sem materializar)', () => {
    const { engine, phone, hr } = seedFederation({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
    });
    const views = engine.execute({ objectId: 'P-778', requirePushdown: true }, alice);
    expect(views).toHaveLength(1);
    expect(views[0]?.provenance).toBe('federated');
    expect(views[0]?.copyOnWrite).toBe(true);
    expect(engine.isMaterialized('P-778')).toBe(false);
    expect(engine.sourceHoldsExclusiveCopy('P-778')).toBe(true);
    expect(engine.snapshotCallCount()).toBe(0);
    expect(phone.snapshotCallCount).toBe(0);
    expect(hr.snapshotCallCount).toBe(0);
    expect(phone.federatedQueryCallCount).toBeGreaterThan(0);
    expect(phone.lastPushdown?.primaryKeys).toEqual(['P-778']);
    expect(phone.records.has('P-778')).toBe(true);
    expect(hr.records.has('P-778')).toBe(true);
  });

  it('merge fragments de duas fontes num TemporaryObject', () => {
    const { engine } = seedFederation({ clock: createDeterministicClock() });
    const temp = engine.loadTemporaryObject('P-778', alice);
    expect(temp).toBeTruthy();
    expect(temp && 'properties' in temp && temp.properties.name).toBe('Ada Lovelace');
    expect(temp && 'properties' in temp && temp.properties.phone).toBe('555-1234');
    expect(temp && 'properties' in temp && temp.properties.email).toBe('ada@example.com');
    expect(temp && 'kind' in temp && temp.kind === 'temporary' ? temp.fragments.length : 0).toBe(2);
  });

  it('planner empurra predicado só para a fonte que tem o campo', () => {
    const plan = planFederation(
      {
        predicates: [{ field: 'phone', op: 'eq', value: '555-1234' }],
        requirePushdown: true,
      },
      [
        { sourceId: 'phone-db', objectName: 'people_phones', objectTypeId: 'ot.person', fields: ['id', 'name', 'phone'] },
        { sourceId: 'hr-db', objectName: 'people_hr', objectTypeId: 'ot.person', fields: ['id', 'email', 'ssn'] },
      ],
    );
    expect(plan.pushdowns.map((p) => p.sourceId)).toEqual(['phone-db']);
    expect(plan.pushdowns[0]?.spec.predicates).toEqual([
      { field: 'phone', op: 'eq', value: '555-1234' },
    ]);
  });

  it('promote cria PlatformObject copy-on-write; fonte permanece', () => {
    const { engine, phone } = seedFederation({ clock: createDeterministicClock() });
    engine.execute({ objectId: 'P-778' }, alice);
    const platform = engine.promote('P-778', alice);
    expect(platform?.kind).toBe('platform');
    expect(platform?.copyOnWrite).toBe(true);
    expect(platform?.promotionMetadata.promotedBy).toBe('alice');
    expect(engine.isMaterialized('P-778')).toBe(true);
    expect(engine.sourceHoldsExclusiveCopy('P-778')).toBe(false);
    expect(phone.records.has('P-778')).toBe(true);
    expect(engine.snapshotCallCount()).toBe(0);
  });

  it('addProperty/addLink atualizam temp e platform', () => {
    const { engine } = seedFederation({ clock: createDeterministicClock() });
    engine.execute({ objectId: 'P-778' }, alice);
    engine.promote('P-778', alice);
    engine.applyPromotion('P-778', { type: 'addProperty', key: 'title', value: 'Analyst' });
    engine.applyPromotion('P-778', { type: 'addLink', targetId: 'P-001', linkType: 'friend' });
    engine.applyPromotion('P-778', { type: 'updateProperty', key: 'email', value: 'ada.l@example.com' });
    const temp = engine.getTempObject('P-778');
    const platform = engine.getPlatformObject('P-778');
    expect(temp?.properties.title).toBe('Analyst');
    expect(platform?.properties.title).toBe('Analyst');
    expect(platform?.properties.email).toBe('ada.l@example.com');
    expect(platform?.links).toContainEqual({ targetId: 'P-001', linkType: 'friend' });
  });

  it('ACL da fonte redige SSN para Bob; Alice vê', () => {
    const { engine } = seedFederation({ clock: createDeterministicClock() });
    const bobView = engine.loadTemporaryObject('P-778', bob);
    const aliceView = engine.loadTemporaryObject('P-778', alice);
    expect(bobView && 'properties' in bobView ? bobView.properties.name : undefined).toBe('Ada Lovelace');
    expect(bobView && 'properties' in bobView ? bobView.properties.ssn : 'x').toBeUndefined();
    expect(aliceView && 'properties' in aliceView ? aliceView.properties.ssn : undefined).toBe(FED_SSN_SECRET);
    expect(JSON.stringify(bobView)).not.toContain(FED_SSN_SECRET);
  });

  it('displayLink marca absentFromStore quando o alvo não existe', () => {
    const { engine } = seedFederation({ clock: createDeterministicClock() });
    engine.execute({ objectId: 'P-778' }, alice);
    const link = engine.displayLink('P-778', 'missing', 'friend');
    expect(link.absentFromStore).toBe(true);
    expect(engine.getTempObject('P-778')?.links).toContainEqual(link);
  });

  it('refresh atualiza da fonte e preserva propriedade do usuário', () => {
    const { engine, phone } = seedFederation({ clock: createDeterministicClock() });
    engine.execute({ objectId: 'P-778' }, alice);
    engine.promote('P-778', alice);
    engine.applyPromotion('P-778', { type: 'addProperty', key: 'title', value: 'Analyst' });
    phone.upsertRecord({
      objectId: 'P-778',
      fields: { id: 'P-778', name: 'Ada Lovelace', phone: '555-0000' },
      lastUpdated: '2024-06-02T00:00:00.000Z',
      acl: phone.records.get('P-778')!.acl,
    });
    engine.refresh('P-778');
    const platform = engine.getPlatformObject('P-778');
    expect(platform?.properties.phone).toBe('555-0000');
    expect(platform?.properties.title).toBe('Analyst');
  });

  it('TTL expira a vista temporária sem materializar; fonte permanece', () => {
    let now = Date.parse('2024-06-01T12:00:00.000Z');
    const clock = (): string => new Date(now).toISOString();
    const { engine, phone } = seedFederation({ clock, ttlMs: 5_000 });
    engine.execute({ objectId: 'P-778' }, alice);
    expect(engine.getTempObject('P-778')).toBeTruthy();
    now += 10_000;
    engine.purgeExpired();
    expect(engine.getTempObject('P-778')).toBeUndefined();
    expect(engine.isMaterialized('P-778')).toBe(false);
    expect(phone.records.has('P-778')).toBe(true);
  });

  it('adapter SearchDocument redige SSN e o planner do query-api consome o mesmo shape', () => {
    const { engine } = seedFederation({ clock: createDeterministicClock() });
    const docs = createFederateAdapter(engine)(
      { federate: { objectId: 'P-778' } },
      { id: 'bob', groups: ['analysts'], viewingLevel: 'Unclassified' },
    );
    expect(docs.some((d) => d.primaryKey === 'P-778')).toBe(true);
    expect(JSON.stringify(docs)).not.toContain(FED_SSN_SECRET);
    expect(docs[0]?.properties.ssn).toBeUndefined();
    expect(docs[0]?.properties.name).toBe('Ada Lovelace');
  });
});
