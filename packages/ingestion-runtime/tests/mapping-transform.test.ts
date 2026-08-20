/**
 * ingestion-runtime — tests/mapping-transform.test.ts
 */
import { describe, expect, it } from 'vitest';

import { envelopeToEffects, MappingTransformError, primaryKeyOf } from '../src/index.js';

describe('mapping transform', () => {
  const definition = {
    objectTypeId: 'ot.item',
    primaryKeyFields: ['id'],
    propertyMappings: [
      { sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' as const },
      { sourceField: 'n', propertyTypeId: 'pt.n', transform: 'number' as const },
    ],
    linkMappings: [
      { linkTypeId: 'lt.owner', sourceField: 'owner', targetObjectTypeId: 'ot.owner' },
    ],
  };

  it('builds object and link effects from a pinned definition', () => {
    const effects = envelopeToEffects({
      envelope: {
        connectorId: 'c',
        source: 'file',
        sourceEventId: 'e1',
        occurredAt: 't',
        payload: { id: 7, n: '3', owner: 'o1' },
        metadata: {},
      },
      definition,
      ontologyId: 'ont',
      principal: 'svc',
    });
    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({
      kind: 'project_object',
      cmd: { primaryKey: '7', properties: { 'pt.code': '7', 'pt.n': 3 } },
    });
    expect(effects[1]).toMatchObject({
      kind: 'project_link',
      cmd: { targetPrimaryKey: 'o1', linkTypeId: 'lt.owner' },
    });
  });

  it('missing primary key is a transform error, not a write', () => {
    expect(() => primaryKeyOf({ name: 'x' }, ['id'])).toThrow(MappingTransformError);
    expect(() =>
      envelopeToEffects({
        envelope: {
          connectorId: 'c',
          source: 'file',
          sourceEventId: 'e1',
          occurredAt: 't',
          payload: { name: 'x' },
          metadata: {},
        },
        definition,
        ontologyId: 'ont',
        principal: 'svc',
      }),
    ).toThrow(/primary key/);
  });
});
