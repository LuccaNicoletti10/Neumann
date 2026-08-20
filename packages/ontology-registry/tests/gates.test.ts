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
  it('criar ObjectType + commit versiona', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 't' });
    await r.addPropertyType(o.id, {
      id: 'pt.n',
      displayName: 'N',
      baseType: 'string',
    });
    await r.addObjectType(o.id, {
      id: 'ot.a',
      displayName: 'A',
      propertyTypeIds: ['pt.n'],
    });
    const v1 = await r.commit({ ontologyId: o.id });
    expect(v1.versionNumber).toBe(1);
    expect(v1.objectTypes['ot.a']?.displayName).toBe('A');
    expect(v1.status).toBe('COMMITTED');
  });

  it('mudança = nova versão; nunca in-place', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 't' });
    await r.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    await r.addObjectType(o.id, { id: 'ot.a', displayName: 'A', propertyTypeIds: ['pt.n'] });
    const v1 = await r.commit({ ontologyId: o.id });
    const hash1 = v1.contentHash;

    await r.openDraft(o.id);
    await r.addObjectType(o.id, { id: 'ot.b', displayName: 'B', propertyTypeIds: ['pt.n'] });
    const v2 = await r.commit({ ontologyId: o.id });

    expect(v2.versionNumber).toBe(2);
    expect(v2.contentHash).not.toBe(hash1);
    expect((await r.getVersion(v1.id))?.objectTypes['ot.b']).toBeUndefined();
    expect(Object.isFrozen(v1)).toBe(true);
  });

  it('rollback cria nova versão com conteúdo da target', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 't' });
    await r.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    await r.addObjectType(o.id, { id: 'ot.a', displayName: 'A', propertyTypeIds: ['pt.n'] });
    const v1 = await r.commit({ ontologyId: o.id });

    await r.openDraft(o.id);
    await r.addObjectType(o.id, { id: 'ot.b', displayName: 'B', propertyTypeIds: ['pt.n'] });
    await r.commit({ ontologyId: o.id });

    const v3 = await r.rollback(o.id, v1.id);
    expect(v3.versionNumber).toBe(3);
    expect(v3.contentHash).toBe(v1.contentHash);
    expect(v3.objectTypes['ot.b']).toBeUndefined();
    expect(await r.listVersions(o.id)).toHaveLength(3);
  });

  it('SEMÂNTICA × CINÉTICA no mesmo snapshot', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 't' });
    await r.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    await r.addObjectType(o.id, { id: 'ot.a', displayName: 'A', propertyTypeIds: ['pt.n'] });
    await r.addActionType(o.id, {
      id: 'act.x',
      displayName: 'DoX',
      inputObjectTypeIds: ['ot.a'],
    });
    await r.addFunctionType(o.id, {
      id: 'fn.y',
      displayName: 'calcY',
      inputObjectTypeIds: ['ot.a'],
    });
    const v = await r.commit({ ontologyId: o.id });
    expect(v.objectTypes['ot.a']).toBeTruthy();
    expect(v.actionTypes['act.x']).toBeTruthy();
    expect(v.functionTypes['fn.y']).toBeTruthy();
  });

  it('FunctionType may be replaced only when functionVersion increases', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'fn-ver' });
    await r.addFunctionType(o.id, {
      id: 'fn.y',
      displayName: 'Y',
      inputObjectTypeIds: [],
      artifactHash: 'a'.repeat(64),
      functionVersion: 1,
    });
    await r.commit({ ontologyId: o.id, createdBy: 't' });
    await r.openDraft(o.id);
    await expect(
      r.addFunctionType(o.id, {
        id: 'fn.y',
        displayName: 'Y',
        inputObjectTypeIds: [],
        artifactHash: 'b'.repeat(64),
        functionVersion: 1,
      }),
    ).rejects.toThrow(/functionVersion must increase/);
    await r.addFunctionType(o.id, {
      id: 'fn.y',
      displayName: 'Y',
      inputObjectTypeIds: [],
      artifactHash: 'b'.repeat(64),
      functionVersion: 2,
    });
    const v2 = await r.commit({ ontologyId: o.id, createdBy: 't' });
    expect(v2.functionTypes['fn.y']?.functionVersion).toBe(2);
    expect(v2.functionTypes['fn.y']?.artifactHash).toBe('b'.repeat(64));
  });

  it('cli demo exit 0', async () => {
    const lines: string[] = [];
    expect(await runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});

describe('ActionType parameter schema validation', () => {
  it('accepts an action with valid parameters', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'schema-ok' });
    await expect(
      r.addActionType(o.id, {
        id: 'act.valid',
        displayName: 'Valid',
        inputObjectTypeIds: [],
        parameters: {
          qty: { baseType: 'number', min: 0, max: 100 },
          code: { baseType: 'string', pattern: '^[A-Z]{3}$' },
          status: { baseType: 'string', allowedValues: ['open', 'closed'] },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an action with an invalid regex pattern', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'schema-bad-pattern' });
    await expect(
      r.addActionType(o.id, {
        id: 'act.badpattern',
        displayName: 'Bad',
        inputObjectTypeIds: [],
        parameters: { code: { baseType: 'string', pattern: '[' } },
      }),
    ).rejects.toThrow(/invalid parameter schema/);
  });

  it('rejects an action with min/max on a non-numeric type', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'schema-bad-bounds' });
    await expect(
      r.addActionType(o.id, {
        id: 'act.badbounds',
        displayName: 'Bad',
        inputObjectTypeIds: [],
        parameters: { name: { baseType: 'string', min: 0 } },
      }),
    ).rejects.toThrow(/invalid parameter schema/);
  });

  it('rejects an action with allowedValues that mismatch baseType', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'schema-bad-enum' });
    await expect(
      r.addActionType(o.id, {
        id: 'act.badenum',
        displayName: 'Bad',
        inputObjectTypeIds: [],
        parameters: { qty: { baseType: 'number', allowedValues: ['not-a-number'] } },
      }),
    ).rejects.toThrow(/invalid parameter schema/);
  });

  it('rejects an action with a pattern exceeding max length', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'schema-long-pattern' });
    await expect(
      r.addActionType(o.id, {
        id: 'act.longpattern',
        displayName: 'Bad',
        inputObjectTypeIds: [],
        parameters: { code: { baseType: 'string', pattern: 'a'.repeat(1001) } },
      }),
    ).rejects.toThrow(/invalid parameter schema/);
  });

  it('rejects a short pathological nested-quantifier pattern at registration', async () => {
    const r = reg();
    const o = await r.createOntology({ name: 'schema-nested-quantifiers' });
    await expect(
      r.addActionType(o.id, {
        id: 'act.redos',
        displayName: 'Bad',
        inputObjectTypeIds: [],
        parameters: { code: { baseType: 'string', pattern: '(a+)+$' } },
      }),
    ).rejects.toThrow(/invalid parameter schema/);
  });
});
