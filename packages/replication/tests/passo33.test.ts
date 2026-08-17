/**
 * replication — tests/passo33.test.ts
 * Gate: réplica sem permissão converge mesmo recebendo mudança redigida.
 */
import { describe, expect, it } from 'vitest';

import { SECRET } from 'contracts';

import { runDemo } from '../src/cli.js';
import {
  compareVectors,
  createExportingSystem,
  createIdGenerator,
  createImportingSystem,
  createOntologyMap,
  createReplicationSite,
  mapsCompatible,
  propertyRoundTripStable,
  replicate,
} from '../src/index.js';

const SSN = '800-88-8888';

describe('Passo 33 — replication cross-ACL', () => {
  it('CLI demo exit 0 e sem leak de SSN', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
    expect(lines.join('\n')).not.toContain(SSN);
  });

  it('gate: B sem permissão recebe SSN redigido e converge no visível', () => {
    const nextId = createIdGenerator();
    const A = createReplicationSite({ id: 'A', nextId });
    const B = createReplicationSite({ id: 'B', nextId });
    A.mutate({ objectId: 'R101', unitId: 'Name', objectType: 'Person', payload: 'John Smith', acl: 'public' });
    A.mutate({
      objectId: 'R101',
      unitId: 'SSN',
      payload: SSN,
      acl: 'private',
      classification: 'Secret',
    });
    const results = replicate(A, B, { allowedAcls: ['public'], maxClassificationRank: SECRET.rank });
    expect(results.some((r) => r.status === 'applied')).toBe(true);
    expect(B.visibleValue('R101', 'Name')).toBe('John Smith');
    expect(A.visibleValue('R101', 'Name')).toBe(B.visibleValue('R101', 'Name'));
    expect(B.visibleValue('R101', 'SSN')).toBeUndefined();
    expect(B.getObject('R101')?.units['SSN']?.redacted).toBe(true);
    expect(JSON.stringify(B.getObject('R101'))).not.toContain(SSN);
    const ssnA = A.getObject('R101')?.units['SSN']?.version ?? {};
    const ssnB = B.getObject('R101')?.units['SSN']?.version ?? {};
    expect(compareVectors(ssnA, ssnB)).toBe('identical');
    const ck = A.checkpoint('B');
    expect((ck.vector['A'] ?? 0) >= 1).toBe(true);
  });

  it('mudança de ACL é mutation e replica', () => {
    const nextId = createIdGenerator();
    const A = createReplicationSite({ id: 'A', nextId });
    const B = createReplicationSite({ id: 'B', nextId });
    A.mutate({ objectId: 'o1', unitId: 'title', payload: 'Ada', acl: 'private' });
    replicate(A, B, { allowedAcls: ['public'] });
    expect(B.getObject('o1')?.units['title']?.redacted).toBe(true);
    A.mutate({ objectId: 'o1', unitId: 'title', operation: 'acl', payload: null, acl: 'public' });
    replicate(A, B, { allowedAcls: ['public'] });
    expect(B.getObject('o1')?.units['title']?.acl).toBe('public');
  });

  it('incremental: chunks + duplicate skip + snapshot', () => {
    const nextId = createIdGenerator();
    const A = createReplicationSite({ id: 'A', nextId });
    const B = createReplicationSite({ id: 'B', nextId });
    A.mutate({ objectId: 'o1', unitId: 'p', payload: '1', acl: 'public' });
    A.mutate({ objectId: 'o2', unitId: 'p', payload: '2', acl: 'public' });
    const exp = createExportingSystem(A, nextId);
    const imp = createImportingSystem(B);
    const plan = exp.plan('B', { chunkSize: 1 });
    expect(plan.chunks.length).toBeGreaterThanOrEqual(2);
    const chunks = exp.execute(plan.planId, { allowedAcls: ['public'] });
    expect(imp.receiveChunk(chunks[0]!).duplicate).toBe(false);
    expect(imp.receiveChunk(chunks[0]!).duplicate).toBe(true);
    for (const c of chunks.slice(1)) imp.receiveChunk(c);
    expect(B.visibleValue('o1', 'p')).toBe('1');
    expect(B.visibleValue('o2', 'p')).toBe('2');
  });

  it('ontology map digest + drop + 1:1 + round-trip', () => {
    const spec = {
      systemIds: ['A', 'B'] as [string, string],
      objectMappings: { Person: 'Employee' },
      propertyMappings: { title: 'displayName' },
      linkMappings: {},
      objectParentChild: { Agent: ['Person'] },
      linkParentChild: {},
      linkReverse: ['ParentOf'],
      droppedTypes: { A: ['InternalNote'] },
    };
    const a = createOntologyMap(spec);
    const b = createOntologyMap(spec);
    expect(mapsCompatible(a, b)).toBe(true);
    expect(a.digest()).toHaveLength(64);
    expect(a.shouldDrop('A', 'InternalNote')).toBe(true);
    expect(a.mapType('Person', 'object')).toBe('Employee');
    expect(a.shouldReverseLink('ParentOf')).toBe(true);
    const dropped = a.rewrite(
      {
        mutationId: 'm1',
        sourceReplica: 'A',
        logicalClock: 1,
        objectId: 'x',
        unitId: 'body',
        objectType: 'InternalNote',
        operation: 'create',
        payload: 'secret-note',
        redacted: false,
        policy: { acl: 'public' },
        timestamp: '2024-06-01T12:00:00.000Z',
        dependencies: [],
        version: { A: 1 },
      },
      'A',
    );
    expect(dropped).toBeNull();
    expect(propertyRoundTripStable('42', 'string', 'number')).toBe(true);
    expect(propertyRoundTripStable('abc', 'string', 'number')).toBe(true);
  });

  it('stale mutation é descartada (vector ordered-before)', () => {
    const nextId = createIdGenerator();
    const A = createReplicationSite({ id: 'A', nextId });
    const B = createReplicationSite({ id: 'B', nextId });
    const v1 = A.mutate({ objectId: 'o', unitId: 'p', payload: 'one', acl: 'public' });
    const v2 = A.mutate({ objectId: 'o', unitId: 'p', payload: 'two', acl: 'public' });
    expect(B.apply(v2).status).toBe('applied');
    expect(B.apply(v1).status).toBe('discarded');
    expect(B.visibleValue('o', 'p')).toBe('two');
  });
});
