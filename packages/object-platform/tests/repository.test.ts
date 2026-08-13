/**
 * object-platform — tests/repository.test.ts
 */
import { describe, expect, it } from 'vitest';

import { VersionConflictError } from '../src/core/errors.js';
import { LinkIntegrityError } from '../src/core/errors.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createMemoryLinkRepository } from '../src/core/link-repository.js';
import { createMemoryObjectRepository } from '../src/core/object-repository.js';

describe('ObjectRepository + LinkRepository', () => {
  it('CRUD objects and traverse links', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const links = createMemoryLinkRepository({ clock, nextId });

    const a = await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.a',
      primaryKey: '1',
      properties: { n: 'x' },
      source: 'unit',
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.b',
      primaryKey: '2',
      properties: { n: 'y' },
    });

    const updated = await objects.update('o1', 'ot.a', '1', {
      properties: { n: 'z' },
    });
    expect(updated.version).toBe(a.version + 1);
    expect(updated.properties.n).toBe('z');

    await links.create({
      ontologyId: 'o1',
      linkTypeId: 'lt.ab',
      sourceObjectTypeId: 'ot.a',
      sourcePrimaryKey: '1',
      targetObjectTypeId: 'ot.b',
      targetPrimaryKey: '2',
      cardinality: '1:N',
    });

    const from = await links.listFrom('o1', 'ot.a', '1', 'lt.ab');
    expect(from).toHaveLength(1);
    expect(from[0]?.targetPrimaryKey).toBe('2');

    expect(await objects.delete('o1', 'ot.a', '1')).toBe(true);
    expect(await objects.get('o1', 'ot.a', '1')).toBeUndefined();
  });

  it('delete CAS rejects stale expectedVersion', async () => {
    const objects = createMemoryObjectRepository({
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.a',
      primaryKey: '1',
      properties: { n: 1 },
    });
    await objects.update('o1', 'ot.a', '1', { properties: { n: 2 } });
    expect(() => objects.delete('o1', 'ot.a', '1', { expectedVersion: 1 })).toThrow(
      VersionConflictError,
    );
    expect(await objects.get('o1', 'ot.a', '1')).toBeTruthy();
    expect(objects.delete('o1', 'ot.a', '1', { expectedVersion: 2 })).toBe(true);
  });

  it('rejects dangling link endpoints and N:1 cardinality', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const links = createMemoryLinkRepository({
      clock,
      nextId,
      objectExists: async (oid, t, pk) => Boolean(await objects.get(oid, t, pk)),
      cardinalityOf: async () => 'N:1',
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.emp',
      primaryKey: 'E1',
      properties: {},
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.mgr',
      primaryKey: 'M1',
      properties: {},
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.mgr',
      primaryKey: 'M2',
      properties: {},
    });

    await expect(
      links.create({
        ontologyId: 'o1',
        linkTypeId: 'lt.manager',
        sourceObjectTypeId: 'ot.emp',
        sourcePrimaryKey: 'MISSING',
        targetObjectTypeId: 'ot.mgr',
        targetPrimaryKey: 'M1',
      }),
    ).rejects.toThrow(LinkIntegrityError);

    await links.create({
      ontologyId: 'o1',
      linkTypeId: 'lt.manager',
      sourceObjectTypeId: 'ot.emp',
      sourcePrimaryKey: 'E1',
      targetObjectTypeId: 'ot.mgr',
      targetPrimaryKey: 'M1',
      cardinality: 'N:N',
    });
    await expect(
      links.create({
        ontologyId: 'o1',
        linkTypeId: 'lt.manager',
        sourceObjectTypeId: 'ot.emp',
        sourcePrimaryKey: 'E1',
        targetObjectTypeId: 'ot.mgr',
        targetPrimaryKey: 'M2',
      }),
    ).rejects.toThrow(/cardinality N:1/);
  });
});
