/**
 * offline-sync — tests/passo34.test.ts
 * Gate: partition + reorder + duplicate + drop + 3+ réplicas → authorized_state igual.
 */
import { describe, expect, it } from 'vitest';

import type { ReplicaObject } from 'contracts';

import { runDemo } from '../src/cli.js';
import {
  compareVectors,
  conflictStatistics,
  createBaseInstallation,
  createDeterministicClock,
  createDisconnectedInstallation,
  createIdGenerator,
  createNetwork,
  createReplica,
  determineTitleSubType,
  detectObjectConflicts,
  filterView,
  incrementVector,
  isOrderedBefore,
  mergeVectors,
  statesConverged,
} from '../src/index.js';

function person(
  overrides: Partial<ReplicaObject> & Pick<ReplicaObject, 'id' | 'title'>,
): ReplicaObject {
  return {
    objectType: 'Person',
    properties: {},
    resolvedWith: [],
    aclPrincipals: ['alice', 'bob'],
    version: {},
    ...overrides,
  };
}

describe('Passo 34 — offline + conflitos', () => {
  it('CLI demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });

  it('version vector: identical / ordered / concurrent', () => {
    const a = { A: 1, B: 0 };
    const b = { A: 2, B: 0 };
    const c = { A: 1, B: 1 };
    expect(compareVectors(a, a)).toBe('identical');
    expect(compareVectors(a, b)).toBe('ordered');
    expect(isOrderedBefore(a, b)).toBe(true);
    expect(isOrderedBefore(b, a)).toBe(false);
    expect(compareVectors(b, c)).toBe('concurrent');
    expect(mergeVectors(b, c)).toEqual({ A: 2, B: 1 });
    expect(incrementVector(a, 'A')).toEqual({ A: 2, B: 0 });
  });

  it('apply ordered, discard stale e duplicate', () => {
    const nextId = createIdGenerator();
    const A = createReplica({ id: 'A', nextId });
    const B = createReplica({ id: 'B', nextId });
    const created = A.upsertObject({
      id: 'p1',
      objectType: 'Person',
      title: 'Ada',
      properties: { city: 'London' },
      aclPrincipals: ['alice'],
    });
    expect(B.apply(created).status).toBe('applied');
    expect(B.apply(created).status).toBe('discarded');
    const v2 = A.patchObject('p1', { properties: { city: 'Paris' } });
    const v3 = A.patchObject('p1', { properties: { city: 'Berlin' } });
    expect(B.apply(v3).status).toBe('applied');
    expect(B.apply(v2).status).toBe('discarded');
    expect(B.getObject('p1')?.properties['city']).toBe('Berlin');
  });

  it('concorrente → conflict → resolve merge/local/peer', () => {
    const nextId = createIdGenerator();
    const A = createReplica({ id: 'A', nextId });
    const B = createReplica({ id: 'B', nextId });
    const created = A.upsertObject({
      id: 'p1',
      objectType: 'Person',
      title: 'Ada',
      properties: { city: 'London', age: 30 },
      aclPrincipals: ['alice'],
    });
    B.apply(created);
    A.patchObject('p1', { title: 'Ada Lovelace' });
    B.patchObject('p1', { title: 'A. Lovelace' });
    const fromB = B.log().at(-1);
    expect(fromB).toBeTruthy();
    expect(A.apply(fromB!).status).toBe('conflict');
    expect(A.pendingConflicts().some((c) => c.type === 'title')).toBe(true);
    A.resolveAll(
      A.pendingConflicts().map((c) => c.id),
      { action: 'acceptLocal' },
    );
    expect(A.getObject('p1')?.title).toBe('Ada Lovelace');
    expect(A.pendingConflicts()).toHaveLength(0);
    const resolution = A.log().at(-1)!;
    expect(B.apply(resolution).status).toBe('applied');
    expect(B.getObject('p1')?.title).toBe('Ada Lovelace');
  });

  it('catálogo ambíguo: tipos, subtipos, grupo, lote', () => {
    const nextId = createIdGenerator();
    const local = person({
      id: 'p1',
      title: 'John Smith',
      objectType: 'Person',
      photo: 'a.jpg',
      properties: { startDate: '2020-01-01', location: 'NYC' },
      version: { A: 2, B: 0 },
    });
    const peer = person({
      id: 'p1',
      title: 'john smith',
      objectType: 'Employee',
      photo: 'b.jpg',
      deleted: true,
      properties: { startDate: '2021-01-01', location: 'BOS', elevation: '10m' },
      resolvedWith: ['p2'],
      version: { A: 1, B: 1 },
    });
    expect(determineTitleSubType('John', 'john')).toBe('caseDifference');
    expect(determineTitleSubType('John.', 'John')).toBe('punctuationDifference');
    expect(determineTitleSubType('Ada', 'Grace')).toBe('dissimilarTitles');
    const found = detectObjectConflicts(local, peer, {
      nextId,
      now: '2024-06-01T12:00:00.000Z',
      localDeploymentName: 'A',
      peerDeploymentName: 'B',
      localVersion: local.version,
      incomingVersion: peer.version,
    });
    const types = new Set(found.map((c) => c.type));
    expect(types.has('objectType')).toBe(true);
    expect(types.has('title')).toBe(true);
    expect(types.has('photo')).toBe(true);
    expect(types.has('deletion')).toBe(true);
    expect(types.has('geotime')).toBe(true);
    expect(types.has('resolution')).toBe(true);
    const view = filterView(found, 'title');
    expect(view.totalCount).toBe(found.length);
    expect(view.groupedConflicts[0]?.subType).toBe('caseDifference');
    expect(conflictStatistics(found).title).toBe(1);
  });

  it('snapshot autorizado não leva objeto negado', () => {
    const A = createReplica({ id: 'A' });
    A.upsertObject({
      id: 'open',
      objectType: 'Person',
      title: 'Ada',
      aclPrincipals: ['alice', 'bob'],
    });
    A.upsertObject({
      id: 'secret',
      objectType: 'Note',
      title: 'nope',
      aclPrincipals: ['alice'],
    });
    const laptop = A.cloneAuthorized({ replicaId: 'laptop', principal: 'bob' });
    expect(laptop.getObject('open')).toBeTruthy();
    expect(laptop.getObject('secret')).toBeUndefined();
    expect(laptop.authorizedState('bob')).toBe(A.authorizedState('bob'));
    expect(A.authorizedState('alice')).not.toBe(A.authorizedState('bob'));
  });

  it('gate: partition + reorder + duplicate + drop + 3 réplicas convergem', () => {
    const nextId = createIdGenerator();
    const clock = createDeterministicClock();
    const A = createReplica({ id: 'A', nextId, clock });
    const B = createReplica({ id: 'B', nextId, clock });
    const C = createReplica({ id: 'C', nextId, clock });
    const net = createNetwork([A, B, C]);

    A.upsertObject({
      id: 'p1',
      objectType: 'Person',
      title: 'Ada',
      properties: { city: 'London' },
      aclPrincipals: ['alice', 'bob'],
    });
    net.stabilize();
    expect(statesConverged([A, B, C], 'bob')).toBe(true);

    const dropMe = A.patchObject('p1', { properties: { city: 'Paris' } });
    const keep = A.patchObject('p1', { properties: { city: 'Berlin' } });
    net.deliver('A', 'B', { dropIds: [dropMe.id] });
    net.deliver('A', 'C', { reverse: true, duplicate: true });
    expect(B.hasApplied(keep.id)).toBe(true);
    expect(B.apply(dropMe).status).toBe('discarded');
    net.stabilize();
    expect(A.getObject('p1')?.properties['city']).toBe('Berlin');
    expect(statesConverged([A, B, C], 'bob')).toBe(true);

    net.partition('A', 'B');
    A.patchObject('p1', { title: 'Ada Lovelace' });
    B.patchObject('p1', { title: 'A. Lovelace' });
    expect(net.isPartitioned('A', 'B')).toBe(true);
    net.heal('A', 'B');
    net.stabilize();
    const conflicts = A.pendingConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    A.resolveAll(
      conflicts.map((c) => c.id),
      { action: 'acceptLocal' },
    );
    net.stabilize();
    expect(statesConverged([A, B, C], 'bob')).toBe(true);
    expect(A.getObject('p1')?.title).toBe('Ada Lovelace');
    expect(B.getObject('p1')?.title).toBe('Ada Lovelace');
    expect(C.getObject('p1')?.title).toBe('Ada Lovelace');
  });

  it('disconnect → mutations → reconnect → detector → resolução → convergência', () => {
    const nextId = createIdGenerator();
    const A = createReplica({ id: 'A', nextId });
    const B = createReplica({ id: 'B', nextId });
    const C = createReplica({ id: 'C', nextId });
    const net = createNetwork([A, B, C]);
    A.upsertObject({
      id: 'p1',
      objectType: 'Person',
      title: 'Ada',
      properties: { city: 'London' },
      aclPrincipals: ['alice', 'bob'],
    });
    A.upsertObject({
      id: 'secret',
      objectType: 'Note',
      title: 'classified',
      aclPrincipals: ['alice'],
    });
    net.stabilize();

    const laptop = A.cloneAuthorized({ replicaId: 'laptop', principal: 'bob' });
    net.attach(laptop);
    expect(laptop.getObject('secret')).toBeUndefined();

    laptop.patchObject('p1', { properties: { city: 'Lisbon' } });
    A.patchObject('p1', { properties: { city: 'Vienna' } });
    net.stabilizeAuthorized('laptop', 'bob');
    expect(A.pendingConflicts().length).toBeGreaterThan(0);
    A.resolveAll(
      A.pendingConflicts().map((c) => c.id),
      { action: 'acceptLocal' },
    );
    net.stabilizeAuthorized('laptop', 'bob');
    expect(statesConverged([A, B, C, laptop], 'bob')).toBe(true);
    expect(laptop.getObject('secret')).toBeUndefined();
    expect(A.getObject('secret')).toBeTruthy();
    expect(A.getObject('p1')?.properties['city']).toBe('Vienna');
  });

  it('investigação .base/.dsco + claim 1 (mesmos objetos) + claim 7 (adicionais)', () => {
    const nextId = createIdGenerator();
    const hubReplica = createReplica({ id: 'hub', nextId });
    hubReplica.upsertObject({
      id: 'o1',
      objectType: 'Person',
      title: 'John',
      properties: { age: 35 },
      aclPrincipals: ['bob'],
    });
    hubReplica.upsertObject({
      id: 'o2',
      objectType: 'Person',
      title: 'Jane',
      properties: { age: 30 },
      aclPrincipals: ['bob'],
    });
    const base = createBaseInstallation({ replica: hubReplica, nextId });
    const inv = base.createInvestigation({
      name: 'Test',
      description: 'Desc',
      principal: 'bob',
      objectIds: ['o1', 'o2'],
    });
    expect(inv.changeSets).toHaveLength(1);
    const baseFile = base.generateBaseFile(inv.id, ['o1', 'o2']);
    expect(baseFile.investigationId).toBe(inv.id);
    expect(baseFile.objects.map((o) => o.id).sort()).toEqual(['o1', 'o2']);

    const disconnected = createDisconnectedInstallation({ nextId });
    disconnected.loadBaseFile(baseFile);
    disconnected.localChange('o1', { properties: { city: 'Los Angeles' } });
    expect(disconnected.replica.getObject('o1')?.properties['city']).toBe('Los Angeles');

    const disco = disconnected.generateDiscoFile(inv.id);
    expect(disco.changeSets).toHaveLength(1);
    const loaded = base.processDiscoFile(disco, false);
    expect(loaded.records.length).toBeGreaterThan(0);
    const published = base.processDiscoFile(disco, true);
    expect(published.results.some((r) => r.status === 'applied')).toBe(true);
    expect(hubReplica.getObject('o1')?.properties['city']).toBe('Los Angeles');

    hubReplica.patchObject('o2', { properties: { city: 'San Francisco' } });
    const updateSame = base.generateBaseFile(inv.id, ['o1', 'o2']);
    const newCs = updateSame.changeSets[updateSame.changeSets.length - 1];
    const cityRecords = newCs?.records.filter((r) => r.obj_comp_id === 'city_o2') ?? [];
    expect(cityRecords).toHaveLength(1);
    expect(cityRecords[0]?.value).toBe('San Francisco');
    disconnected.loadBaseFile(updateSame);
    expect(disconnected.replica.getObject('o1')?.properties['city']).toBe('Los Angeles');

    hubReplica.upsertObject({
      id: 'o3',
      objectType: 'Person',
      title: 'Alice',
      properties: { age: 28 },
      aclPrincipals: ['bob'],
    });
    const updateExtra = base.generateBaseFile(inv.id, ['o1', 'o2', 'o3']);
    disconnected.loadBaseFile(updateExtra);
    expect(disconnected.replica.getObject('o3')?.title).toBe('Alice');
  });

  it('link set concorrente detecta conflito', () => {
    const nextId = createIdGenerator();
    const A = createReplica({ id: 'A', nextId });
    const B = createReplica({ id: 'B', nextId });
    A.upsertObject({ id: 'o1', objectType: 'Person', title: 'A', aclPrincipals: ['x'] });
    A.upsertObject({ id: 'o2', objectType: 'Person', title: 'B', aclPrincipals: ['x'] });
    const seed = A.log();
    for (const u of seed) B.apply(u);
    A.addLink('o1', 'o2', 'knows');
    B.addLink('o1', 'o2', 'reportsTo');
    const fromB = B.log().at(-1)!;
    expect(A.apply(fromB).status).toBe('conflict');
    A.resolveAll(
      A.pendingConflicts().map((c) => c.id),
      { action: 'merge' },
    );
    expect(A.linkSets()[0]?.links.length).toBe(2);
  });
});
