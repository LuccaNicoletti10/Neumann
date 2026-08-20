/**
 * ingestion-runtime — ConnectorRegistration + MappingVersion repository contract.
 */
import { expect } from 'vitest';

import type { ConnectorRegistrationRepository, MappingVersionRepository } from 'contracts';

import { assertConfigHasNoSecret, IngestionVersionConflictError } from '../src/index.js';

export async function runCatalogContract(opts: {
  connectors: ConnectorRegistrationRepository;
  mappings: MappingVersionRepository;
  now: string;
}): Promise<void> {
  const created = await opts.connectors.put({
    connectorId: 'wh-1',
    kind: 'webhook',
    enabled: true,
    config: { path: '/unused' },
    secretRef: 'connector:wh-1:webhook-secret',
    servicePrincipal: 'svc',
    mappingId: 'map-1',
    ontologyId: 'ont-1',
    version: 0,
    createdAt: opts.now,
    updatedAt: opts.now,
  });
  expect(created.version).toBe(1);
  expect(created.config).not.toHaveProperty('secret');

  const again = await opts.connectors.get('wh-1');
  expect(again?.mappingId).toBe('map-1');

  await expect(
    opts.connectors.put(
      { ...created, enabled: false, updatedAt: opts.now, config: { path: '/unused' } },
      99,
    ),
  ).rejects.toBeInstanceOf(IngestionVersionConflictError);

  const disabled = await opts.connectors.put(
    { ...created, enabled: false, updatedAt: opts.now, config: { path: '/unused' } },
    created.version,
  );
  expect(disabled.version).toBe(2);
  expect(disabled.enabled).toBe(false);

  expect(() => assertConfigHasNoSecret({ secret: 'nope' })).toThrow(/secret/);
  expect(() => assertConfigHasNoSecret({ nested: { password: 'x' } })).toThrow(/password/);
  expect(() => assertConfigHasNoSecret({ nested: { token: 'x' } })).toThrow(/token/);
  expect(() => assertConfigHasNoSecret({ nested: { authorization: 'x' } })).toThrow(/authorization/);
  expect(() => assertConfigHasNoSecret({ nested: { apiKey: 'x' } })).toThrow(/apiKey/);
  expect(() => assertConfigHasNoSecret({ nested: { clientSecret: 'x' } })).toThrow(/clientSecret/);

  const input = {
    mappingId: 'map-1',
    ontologyId: 'ont-1',
    ontologyVersionId: 'ov-1',
    datasetId: 'ds',
    objectTypeId: 'ot.item',
    primaryKeyFields: ['id'],
    propertyMappings: [{ sourceField: 'id', propertyTypeId: 'pt.code', transform: 'string' as const }],
    createdBy: 'test',
  };
  const v1 = await opts.mappings.publish(input);
  expect(v1.versionNumber).toBe(1);
  const identical = await opts.mappings.publish(input);
  expect(identical.id).toBe(v1.id);
  expect(identical.versionNumber).toBe(1);

  const v2 = await opts.mappings.publish({
    ...input,
    propertyMappings: [
      ...input.propertyMappings,
      { sourceField: 'name', propertyTypeId: 'pt.name', transform: 'string' },
    ],
  });
  expect(v2.versionNumber).toBe(2);
  expect(v2.id).not.toBe(v1.id);
  const latest = await opts.mappings.getLatest('map-1');
  expect(latest?.id).toBe(v2.id);
  const pinned = await opts.mappings.getVersion(v1.id);
  expect(pinned?.id).toBe(v1.id);
}
