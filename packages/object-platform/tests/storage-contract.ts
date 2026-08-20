/**
 * Shared object/link contract cases. Same data on memory and PostgreSQL.
 * Only allowed difference: physical durability (restart).
 */
import { expect } from 'vitest';

import type { LinkRepository, ObjectRepository, OntologyVersion } from 'contracts';

import {
  LinkIntegrityError,
  OntologyValidationError,
  VersionConflictError,
} from '../src/core/errors.js';
import { createGovernedObjectRepository } from '../src/core/governed-object-repository.js';
import type { ObjectHistoryStore } from '../src/core/object-history-store.js';

export interface StorageContractStores {
  objects: ObjectRepository;
  links: LinkRepository;
  history: ObjectHistoryStore;
}

export interface StorageContractHarness extends StorageContractStores {
  ontologyId: string;
  uow: <T>(fn: (stores: StorageContractStores) => Promise<T>) => Promise<T>;
  /** Process restart over the same durable schema. Memory omits this. */
  reopen?: () => Promise<StorageContractStores>;
}

const ITEM = 'ot.item';
const PEER = 'ot.peer';
const REL = 'lt.rel';
const CARD = 'lt.card';

async function expectFailure(fn: () => unknown, match: RegExp | (new (...args: never[]) => Error)): Promise<void> {
  try {
    await fn();
    throw new Error('expected failure');
  } catch (err) {
    if (match instanceof RegExp) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(match);
      return;
    }
    expect(err).toBeInstanceOf(match);
  }
}

const GOVERNED_VERSION: OntologyVersion = {
  id: 'ov-contract',
  ontologyId: 'gov',
  versionNumber: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'contract',
  contentHash: 'h',
  status: 'COMMITTED',
  objectTypes: {
    [ITEM]: { id: ITEM, displayName: 'Item', propertyTypeIds: ['n'] },
  },
  propertyTypes: {
    n: { id: 'n', displayName: 'N', baseType: 'string' },
  },
  linkTypes: {},
  actionTypes: {},
  functionTypes: {},
};

export async function runStorageContract(h: StorageContractHarness): Promise<void> {
  const { objects, links, history, ontologyId } = h;

  const a = await objects.create({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'A',
    properties: { n: '1' },
    id: 'obj-a',
  });
  expect(a.id).toBe('obj-a');
  expect(a.version).toBe(1);
  await expectFailure(
    () =>
      objects.create({
        ontologyId,
        objectTypeId: ITEM,
        primaryKey: 'A',
        properties: { n: 'dup' },
      }),
    /already exists/,
  );

  const updated = await objects.update(ontologyId, ITEM, 'A', {
    properties: { n: '2' },
    expectedVersion: 1,
  });
  expect(updated.version).toBe(2);
  await expectFailure(
    () => objects.update(ontologyId, ITEM, 'A', { properties: { n: 'stale' }, expectedVersion: 1 }),
    VersionConflictError,
  );
  expect((await objects.get(ontologyId, ITEM, 'A'))?.properties.n).toBe('2');

  await objects.create({
    ontologyId,
    objectTypeId: PEER,
    primaryKey: 'B',
    properties: { n: 'b' },
  });
  await links.create({
    ontologyId,
    linkTypeId: REL,
    sourceObjectTypeId: ITEM,
    sourcePrimaryKey: 'A',
    targetObjectTypeId: PEER,
    targetPrimaryKey: 'B',
  });
  expect(await links.listFrom(ontologyId, ITEM, 'A', REL)).toHaveLength(1);

  await expectFailure(
    () =>
      links.create({
        ontologyId,
        linkTypeId: REL,
        sourceObjectTypeId: ITEM,
        sourcePrimaryKey: 'MISSING',
        targetObjectTypeId: PEER,
        targetPrimaryKey: 'B',
      }),
    LinkIntegrityError,
  );

  const cardLinks = h.links;
  await objects.create({ ontologyId, objectTypeId: ITEM, primaryKey: 'C1', properties: { n: 'c' } });
  await objects.create({ ontologyId, objectTypeId: PEER, primaryKey: 'M1', properties: {} });
  await objects.create({ ontologyId, objectTypeId: PEER, primaryKey: 'M2', properties: {} });
  await cardLinks.create({
    ontologyId,
    linkTypeId: CARD,
    sourceObjectTypeId: ITEM,
    sourcePrimaryKey: 'C1',
    targetObjectTypeId: PEER,
    targetPrimaryKey: 'M1',
    cardinality: 'N:1',
  });
  await expectFailure(
    () =>
      cardLinks.create({
        ontologyId,
        linkTypeId: CARD,
        sourceObjectTypeId: ITEM,
        sourcePrimaryKey: 'C1',
        targetObjectTypeId: PEER,
        targetPrimaryKey: 'M2',
        cardinality: 'N:1',
      }),
    /cardinality N:1/,
  );

  await history.append({
    objectId: a.id,
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'A',
    version: updated.version,
    properties: { ...updated.properties },
    deleted: false,
    source: 'data_source',
    operation: 'update',
  });
  const trail = await history.listByObject(a.id);
  expect(trail.some((e) => e.version === 2)).toBe(true);
  const asOf = await history.asOf(ontologyId, ITEM, 'A', '9999-01-01T00:00:00.000Z');
  expect(asOf?.primaryKey).toBe('A');

  const listed = await objects.list(ontologyId, PEER, {
    orderBy: { property: 'n', direction: 'asc' },
    limit: 1,
    offset: 0,
  });
  expect(listed).toHaveLength(1);

  expect(await objects.get(ontologyId, ITEM, 'NOPE')).toBeUndefined();
  const gone = await objects.delete(ontologyId, ITEM, 'A', { expectedVersion: 2 });
  expect(gone?.deleted).toBe(true);
  expect(await objects.get(ontologyId, ITEM, 'A')).toBeUndefined();
  expect(await objects.getById(a.id)).toBeUndefined();
  expect((await history.listByObject(a.id)).length).toBeGreaterThan(0);

  const before = await objects.get(ontologyId, PEER, 'B');
  await expect(
    h.uow(async (stores) => {
      await stores.objects.update(ontologyId, PEER, 'B', { properties: { n: 'rolled' } });
      throw new Error('uow-failure');
    }),
  ).rejects.toThrow('uow-failure');
  expect((await objects.get(ontologyId, PEER, 'B'))?.properties.n).toBe(before?.properties.n);

  const governedInner = h.objects;
  const governed = createGovernedObjectRepository({
    inner: governedInner,
    versionPolicy: {
      pin: async () => ({ version: { ...GOVERNED_VERSION, ontologyId } }),
    },
    history,
    mode: 'enforce',
  });
  await expect(
    governed.create({
      ontologyId,
      objectTypeId: 'ot.ghost',
      primaryKey: 'g',
      properties: {},
    }),
  ).rejects.toBeInstanceOf(OntologyValidationError);

  if (h.reopen) {
    const live = await objects.create({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'DUR',
      properties: { n: 'persist' },
    });
    expect(live.version).toBe(1);
    const reopened = await h.reopen();
    const again = await reopened.objects.get(ontologyId, ITEM, 'DUR');
    expect(again?.id).toBe(live.id);
    expect(again?.version).toBe(1);
    expect(again?.properties.n).toBe('persist');
  }
}
