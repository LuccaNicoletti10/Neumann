/**
 * ontology-registry — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createOntologyRegistry } from '../src/core/registry.js';
import { runDemo } from '../src/cli.js';

function reg() {
  return createOntologyRegistry({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}

describe('Passo 17 gates', () => {
  it('criar ObjectType + commit versiona', () => {
    const r = reg();
    const o = r.createOntology({ name: 't' });
    r.addPropertyType(o.id, {
      id: 'pt.n',
      displayName: 'N',
      baseType: 'string',
    });
    r.addObjectType(o.id, {
      id: 'ot.a',
      displayName: 'A',
      propertyTypeIds: ['pt.n'],
    });
    const v1 = r.commit({ ontologyId: o.id });
    expect(v1.versionNumber).toBe(1);
    expect(v1.objectTypes['ot.a']?.displayName).toBe('A');
    expect(v1.status).toBe('COMMITTED');
  });

  it('mudança = nova versão; nunca in-place', () => {
    const r = reg();
    const o = r.createOntology({ name: 't' });
    r.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    r.addObjectType(o.id, { id: 'ot.a', displayName: 'A', propertyTypeIds: ['pt.n'] });
    const v1 = r.commit({ ontologyId: o.id });
    const hash1 = v1.contentHash;

    r.openDraft(o.id);
    r.addObjectType(o.id, { id: 'ot.b', displayName: 'B', propertyTypeIds: ['pt.n'] });
    const v2 = r.commit({ ontologyId: o.id });

    expect(v2.versionNumber).toBe(2);
    expect(v2.contentHash).not.toBe(hash1);
    expect(r.getVersion(v1.id)?.objectTypes['ot.b']).toBeUndefined();
    expect(Object.isFrozen(v1)).toBe(true);
  });

  it('rollback cria nova versão com conteúdo da target', () => {
    const r = reg();
    const o = r.createOntology({ name: 't' });
    r.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    r.addObjectType(o.id, { id: 'ot.a', displayName: 'A', propertyTypeIds: ['pt.n'] });
    const v1 = r.commit({ ontologyId: o.id });

    r.openDraft(o.id);
    r.addObjectType(o.id, { id: 'ot.b', displayName: 'B', propertyTypeIds: ['pt.n'] });
    r.commit({ ontologyId: o.id });

    const v3 = r.rollback(o.id, v1.id);
    expect(v3.versionNumber).toBe(3);
    expect(v3.contentHash).toBe(v1.contentHash);
    expect(v3.objectTypes['ot.b']).toBeUndefined();
    expect(r.listVersions(o.id)).toHaveLength(3);
  });

  it('SEMÂNTICA × CINÉTICA no mesmo snapshot', () => {
    const r = reg();
    const o = r.createOntology({ name: 't' });
    r.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    r.addObjectType(o.id, { id: 'ot.a', displayName: 'A', propertyTypeIds: ['pt.n'] });
    r.addActionType(o.id, {
      id: 'act.x',
      displayName: 'DoX',
      inputObjectTypeIds: ['ot.a'],
    });
    r.addFunctionType(o.id, {
      id: 'fn.y',
      displayName: 'calcY',
      inputObjectTypeIds: ['ot.a'],
    });
    const v = r.commit({ ontologyId: o.id });
    expect(v.objectTypes['ot.a']).toBeTruthy();
    expect(v.actionTypes['act.x']).toBeTruthy();
    expect(v.functionTypes['fn.y']).toBeTruthy();
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
