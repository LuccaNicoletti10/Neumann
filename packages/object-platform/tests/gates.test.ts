/**
 * object-platform — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import type { AuthorizeFn } from 'contracts';

import { runDemo } from '../src/cli.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createObjectPlatform } from '../src/core/platform.js';

function plat(authorize?: AuthorizeFn) {
  return createObjectPlatform({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
    authorize,
  });
}

describe('Passo 18 gates', () => {
  it('mapping versiona (nunca in-place)', () => {
    const p = plat();
    const m = p.createMapping({
      name: 'm',
      datasetId: 'ds',
      objectTypeId: 'ot.a',
      ontologyVersionId: 'ov-1',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'n', propertyTypeId: 'pt.n', transform: 'string' }],
    });
    const v1 = p.getLatestMappingVersion(m.id)!;
    const draft = p.openMappingDraft(m.id);
    draft.propertyMappings.push({
      sourceField: 'e',
      propertyTypeId: 'pt.e',
      transform: 'string',
    });
    p.setMappingDraft(m.id, draft);
    const v2 = p.commitMapping({ mappingId: m.id });
    expect(v2.versionNumber).toBe(2);
    expect(v2.contentHash).not.toBe(v1.contentHash);
    expect(p.getMappingVersion(v1.id)?.propertyMappings).toHaveLength(1);
    expect(Object.isFrozen(v1)).toBe(true);
  });

  it('projetor upsert + history + provenance', () => {
    const p = plat();
    const m = p.createMapping({
      name: 'm',
      datasetId: 'ds',
      objectTypeId: 'ot.a',
      ontologyVersionId: 'ov-1',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'n', propertyTypeId: 'pt.n', transform: 'string' }],
    });
    const mv = p.getLatestMappingVersion(m.id)!;
    const r = p.project({
      mappingVersionId: mv.id,
      datasetVersionId: 'dv-1',
      rows: [{ fields: { id: '1', n: 'x' } }],
    });
    expect(r.upserted).toBe(1);
    const obj = p.getObject('alice', r.objectIds[0]!)!;
    expect(obj.properties['pt.n']).toBe('x');
    expect(p.getHistory('alice', obj.id)).toHaveLength(1);
    expect(p.getProvenance('alice', obj.id)?.datasetVersionId).toBe('dv-1');
  });

  it('user_edit vence reproject data_source', () => {
    const p = plat();
    const m = p.createMapping({
      name: 'm',
      datasetId: 'ds',
      objectTypeId: 'ot.a',
      ontologyVersionId: 'ov-1',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'n', propertyTypeId: 'pt.n', transform: 'string' }],
    });
    const mv = p.getLatestMappingVersion(m.id)!;
    const r = p.project({
      mappingVersionId: mv.id,
      datasetVersionId: 'dv-1',
      rows: [{ fields: { id: '1', n: 'old' } }],
    });
    const id = r.objectIds[0]!;
    p.applyUserEdit(id, { 'pt.n': 'user' }, 'alice');
    p.project({
      mappingVersionId: mv.id,
      datasetVersionId: 'dv-2',
      rows: [{ fields: { id: '1', n: 'source' } }],
    });
    expect(p.getObject('alice', id)?.properties['pt.n']).toBe('user');
  });

  it('Object API get/query/traverse/history; deny esconde', () => {
    const deny = new Set<string>();
    const authorize: AuthorizeFn = (req) =>
      deny.has(req.resource)
        ? {
            decision: 'deny',
            principalEpids: [],
            resourceEpid: null,
            reason: 'deny',
          }
        : {
            decision: 'allow',
            principalEpids: [],
            resourceEpid: null,
            reason: 'ok',
          };

    const p = plat(authorize);
    const m = p.createMapping({
      name: 'm',
      datasetId: 'ds',
      objectTypeId: 'ot.a',
      ontologyVersionId: 'ov-1',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'n', propertyTypeId: 'pt.n', transform: 'string' }],
      linkMappings: [
        {
          linkTypeId: 'lt.p',
          sourceField: 'parent',
          targetObjectTypeId: 'ot.a',
        },
      ],
    });
    const mv = p.getLatestMappingVersion(m.id)!;
    p.project({
      mappingVersionId: mv.id,
      datasetVersionId: 'dv-1',
      rows: [
        { fields: { id: 'A', n: 'parent', parent: '' } },
        { fields: { id: 'B', n: 'child', parent: 'A' } },
      ],
    });
    const all = p.queryObjects('alice', { objectTypeId: 'ot.a' });
    expect(all).toHaveLength(2);
    const child = all.find((o) => o.primaryKey === 'B')!;
    const parents = p.traverseLinks('alice', child.id);
    expect(parents[0]?.primaryKey).toBe('A');

    deny.add(`object:${child.id}`);
    expect(p.getObject('alice', child.id)).toBeNull();
    expect(p.queryObjects('alice', { objectTypeId: 'ot.a' })).toHaveLength(1);
    expect(p.getHistory('alice', child.id)).toBeNull();
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
