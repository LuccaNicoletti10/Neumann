/**
 * object-platform — tests/projection-request-identity.test.ts
 *
 * Golden tests: every semantically relevant field must produce a different hash
 * when changed. Reordering properties must not change the hash (canonical JSON).
 */

import { describe, expect, it } from 'vitest';

import { buildProjectionRequestIdentity, normaliseEffect } from '../src/core/projection-request-identity.js';

const base = buildProjectionRequestIdentity({
  source: 'erp',
  ontologyId: 'ont1',
  sourceEventId: 'evt1',
  principal: 'svc',
  observedAt: '2026-08-19T00:00:00Z',
  provenance: { system: 'erp' },
  effects: [
    normaliseEffect(
      {
        kind: 'project_link',
        cmd: {
          ontologyId: 'ont1',
          linkTypeId: 'lt.member',
          sourceObjectTypeId: 'ot.person',
          sourcePrimaryKey: 'alice',
          targetObjectTypeId: 'ot.dept',
          targetPrimaryKey: 'dept-1',
          cardinality: 'N:1',
          source: 'erp',
          sourceEventId: 'evt1',
          principal: 'svc',
        },
      },
      'svc',
    ),
  ],
});

describe('buildProjectionRequestIdentity golden tests', () => {
  it('baseline produces a stable hash', () => {
    expect(typeof base.batchHash).toBe('string');
    expect(base.batchHash.length).toBeGreaterThan(8);
    expect(base.hashVersion).toBe(1);
  });

  it('changing cardinality alters hash', () => {
    const changed = buildProjectionRequestIdentity({
      ...base.fingerprint,
      effects: [
        normaliseEffect(
          {
            kind: 'project_link',
            cmd: {
              ontologyId: 'ont1',
              linkTypeId: 'lt.member',
              sourceObjectTypeId: 'ot.person',
              sourcePrimaryKey: 'alice',
              targetObjectTypeId: 'ot.dept',
              targetPrimaryKey: 'dept-1',
              cardinality: '1:N', // changed from N:1
              source: 'erp',
              sourceEventId: 'evt1',
              principal: 'svc',
            },
          },
          'svc',
        ),
      ],
    });
    expect(changed.batchHash).not.toBe(base.batchHash);
  });

  it('changing source object type alters hash', () => {
    const changed = buildProjectionRequestIdentity({
      ...base.fingerprint,
      effects: [
        normaliseEffect(
          {
            kind: 'project_link',
            cmd: {
              ontologyId: 'ont1',
              linkTypeId: 'lt.member',
              sourceObjectTypeId: 'ot.employee', // changed
              sourcePrimaryKey: 'alice',
              targetObjectTypeId: 'ot.dept',
              targetPrimaryKey: 'dept-1',
              cardinality: 'N:1',
              source: 'erp',
              sourceEventId: 'evt1',
              principal: 'svc',
            },
          },
          'svc',
        ),
      ],
    });
    expect(changed.batchHash).not.toBe(base.batchHash);
  });

  it('changing target object type alters hash', () => {
    const changed = buildProjectionRequestIdentity({
      ...base.fingerprint,
      effects: [
        normaliseEffect(
          {
            kind: 'project_link',
            cmd: {
              ontologyId: 'ont1',
              linkTypeId: 'lt.member',
              sourceObjectTypeId: 'ot.person',
              sourcePrimaryKey: 'alice',
              targetObjectTypeId: 'ot.team', // changed
              targetPrimaryKey: 'dept-1',
              cardinality: 'N:1',
              source: 'erp',
              sourceEventId: 'evt1',
              principal: 'svc',
            },
          },
          'svc',
        ),
      ],
    });
    expect(changed.batchHash).not.toBe(base.batchHash);
  });

  it('reordering properties inside properties map does not alter hash', () => {
    const a = buildProjectionRequestIdentity({
      source: 'erp',
      ontologyId: 'ont1',
      sourceEventId: 'evt2',
      principal: 'svc',
      observedAt: undefined,
      provenance: undefined,
      effects: [
        normaliseEffect(
          {
            kind: 'project_object',
            cmd: {
              ontologyId: 'ont1',
              objectTypeId: 'ot.order',
              primaryKey: 'o1',
              properties: { b: 2, a: 1 }, // b before a
              source: 'erp',
              sourceEventId: 'evt2',
              principal: 'svc',
            },
          },
          'svc',
        ),
      ],
    });
    const b = buildProjectionRequestIdentity({
      source: 'erp',
      ontologyId: 'ont1',
      sourceEventId: 'evt2',
      principal: 'svc',
      observedAt: undefined,
      provenance: undefined,
      effects: [
        normaliseEffect(
          {
            kind: 'project_object',
            cmd: {
              ontologyId: 'ont1',
              objectTypeId: 'ot.order',
              primaryKey: 'o1',
              properties: { a: 1, b: 2 }, // a before b
              source: 'erp',
              sourceEventId: 'evt2',
              principal: 'svc',
            },
          },
          'svc',
        ),
      ],
    });
    // WHY: canonical JSON sorts keys recursively — insertion order must not matter.
    expect(a.batchHash).toBe(b.batchHash);
  });

  it('changing effect order alters hash (order is part of the fingerprint)', () => {
    const eff1 = normaliseEffect(
      { kind: 'project_object', cmd: { ontologyId: 'ont1', objectTypeId: 'ot.a', primaryKey: 'p1', properties: {}, source: 'erp', sourceEventId: 'e', principal: 'svc' } },
      'svc',
    );
    const eff2 = normaliseEffect(
      { kind: 'project_object', cmd: { ontologyId: 'ont1', objectTypeId: 'ot.b', primaryKey: 'p2', properties: {}, source: 'erp', sourceEventId: 'e', principal: 'svc' } },
      'svc',
    );
    const ab = buildProjectionRequestIdentity({ source: 'erp', ontologyId: 'ont1', sourceEventId: 'e', principal: 'svc', observedAt: undefined, provenance: undefined, effects: [eff1, eff2] });
    const ba = buildProjectionRequestIdentity({ source: 'erp', ontologyId: 'ont1', sourceEventId: 'e', principal: 'svc', observedAt: undefined, provenance: undefined, effects: [eff2, eff1] });
    expect(ab.batchHash).not.toBe(ba.batchHash);
  });

  it('changing provenance only alters hash', () => {
    const withProv = buildProjectionRequestIdentity({
      ...base.fingerprint,
      provenance: { system: 'erp', batch: '99' },
    });
    expect(withProv.batchHash).not.toBe(base.batchHash);
  });

  it('changing observedAt only alters hash', () => {
    const changed = buildProjectionRequestIdentity({
      ...base.fingerprint,
      observedAt: '2026-08-20T00:00:00Z',
    });
    expect(changed.batchHash).not.toBe(base.batchHash);
  });
});

describe('normaliseEffect — explicit field names', () => {
  it('project_link has all endpoint and cardinality fields at top level', () => {
    const fp = normaliseEffect(
      {
        kind: 'project_link',
        cmd: {
          ontologyId: 'o',
          linkTypeId: 'lt',
          sourceObjectTypeId: 'src',
          sourcePrimaryKey: 'sp',
          targetObjectTypeId: 'tgt',
          targetPrimaryKey: 'tp',
          cardinality: '1:1',
          source: 's',
          sourceEventId: 'se',
          principal: 'p',
        },
      },
      'p',
    );
    expect(fp.kind).toBe('project_link');
    if (fp.kind === 'project_link') {
      expect(fp.linkTypeId).toBe('lt');
      expect(fp.sourceObjectTypeId).toBe('src');
      expect(fp.targetObjectTypeId).toBe('tgt');
      expect(fp.cardinality).toBe('1:1');
    }
  });

  it('delete_link has expectedVersion at top level', () => {
    const fp = normaliseEffect(
      {
        kind: 'delete_link',
        cmd: {
          ontologyId: 'o',
          linkTypeId: 'lt',
          sourceObjectTypeId: 'src',
          sourcePrimaryKey: 'sp',
          targetObjectTypeId: 'tgt',
          targetPrimaryKey: 'tp',
          expectedVersion: 3,
          source: 's',
          sourceEventId: 'se',
          principal: 'p',
        },
      },
      'p',
    );
    if (fp.kind === 'delete_link') {
      expect(fp.expectedVersion).toBe(3);
    }
  });
});
