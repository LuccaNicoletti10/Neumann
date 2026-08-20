/**
 * contracts — RawEnvelope is the ingestion subset of CanonicalEvent (ADR-0016).
 */
import { describe, expect, it } from 'vitest';

import {
  assertIngestionMappingPin,
  assertRawEnvelope,
  envelopeFromCanonical,
  pinFromMappingVersion,
} from '../src/v1/ingestion.js';
import type { CanonicalEvent } from '../src/v1/canonical-event.js';
import type { MappingVersion } from '../src/v1/object-platform.js';

describe('ingestion contracts', () => {
  it('envelopeFromCanonical copies identity without inventing ObjectType', () => {
    const event: CanonicalEvent = {
      event_id: 'evt-1',
      source_system: 'file',
      source_object: 'csv',
      source_primary_key: '1',
      schema_version: '1',
      occurred_at: 't0',
      ingested_at: 't1',
      connector_id: 'csv',
      checkpoint: '1',
      principal: 'sa:csv',
      policy_tags: [],
      payload_hash: 'h',
      payload: { id: '1' },
    };
    const env = envelopeFromCanonical(event);
    expect(env.sourceEventId).toBe('evt-1');
    expect(env.connectorId).toBe('csv');
    expect(env.payload).toEqual({ id: '1' });
    expect(env).not.toHaveProperty('objectTypeId');
    assertRawEnvelope(env);
  });

  it('assertRawEnvelope rejects a payload without identity', () => {
    expect(() => assertRawEnvelope({ connectorId: 'x' })).toThrow(/source/);
  });

  it('pinFromMappingVersion snapshots definition and does not alias the catalog record', () => {
    const mv: MappingVersion = {
      id: 'mv-1',
      mappingId: 'map-1',
      versionNumber: 2,
      createdAt: 't',
      createdBy: 't',
      contentHash: 'abc',
      status: 'COMMITTED',
      datasetId: 'ds',
      ontologyVersionId: 'ov-1',
      objectTypeId: 'ot.item',
      primaryKeyFields: ['id'],
      propertyMappings: [{ sourceField: 'id', propertyTypeId: 'pt.code' }],
      linkMappings: [],
    };
    const pin = pinFromMappingVersion(mv, 'ont');
    expect(pin.hash).toBe('abc');
    expect(pin.ontologyId).toBe('ont');
    expect(pin.definition.objectTypeId).toBe('ot.item');
    pin.definition.primaryKeyFields.push('extra');
    expect(mv.primaryKeyFields).toEqual(['id']);
    assertIngestionMappingPin(pin);
  });

  it('assertIngestionMappingPin rejects a pin without definition', () => {
    expect(() =>
      assertIngestionMappingPin({
        mappingId: 'm',
        mappingVersionId: 'v',
        version: 1,
        hash: 'h',
        ontologyId: 'o',
        ontologyVersionId: 'ov',
      }),
    ).toThrow(/definition/);
  });
});
