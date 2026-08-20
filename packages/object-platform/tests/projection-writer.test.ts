/**
 * ProjectionWriter — ingest port: replay, conflict, deny, rollback.
 */
import { describe, expect, it } from 'vitest';

import type {
  AuthorizeFn,
  AuthorizeResult,
  OperationalEvent,
  OntologyVersion,
  OperationalEventStore,
  OutboxInsertInput,
  OutboxRepository,
} from 'contracts';

import { ProjectionConflictError, ProjectionDeniedError, VersionConflictError } from '../src/core/errors.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createGovernedObjectRepository } from '../src/core/governed-object-repository.js';
import type { OntologyVersionPolicy } from '../src/core/ontology-version-policy.js';
import { createMemoryLinkRepository } from '../src/core/link-repository.js';
import { restoreArray, type MemoryCheckpoint } from '../src/core/memory-checkpoint.js';
import { createSnapshotUnitOfWork } from '../src/core/memory-transaction-boundary.js';
import { createMemoryObjectHistoryStore } from '../src/core/object-history-store.js';
import { createMemoryObjectRepository } from '../src/core/object-repository.js';
import { createMemoryProjectionLedger } from '../src/core/projection-ledger.js';
import { createProjectionWriter } from '../src/core/projection-writer.js';

const allow: AuthorizeFn = (): AuthorizeResult => ({
  decision: 'allow',
  principalEpids: ['p'],
  resourceEpid: 'admin:projection',
  reason: 'ok',
});

const deny: AuthorizeFn = (): AuthorizeResult => ({
  decision: 'deny',
  principalEpids: [],
  resourceEpid: null,
  reason: 'no',
});

function eventStore(): OperationalEventStore & MemoryCheckpoint & { rows: OperationalEvent[] } {
  const rows: OperationalEvent[] = [];
  return {
    rows,
    async append(event) {
      const rec: OperationalEvent = {
        id: `evt-${rows.length + 1}`,
        at: 't',
        kind: event.kind,
        ontologyId: event.ontologyId,
        principal: event.principal,
        objectId: event.objectId,
        objectTypeId: event.objectTypeId,
        primaryKey: event.primaryKey,
        linkId: event.linkId,
        linkTypeId: event.linkTypeId,
        payload: event.payload,
      };
      rows.push(rec);
      return rec;
    },
    async list() {
      return rows;
    },
    capture() {
      return rows.map((r) => ({ ...r }));
    },
    restore(snapshot: unknown) {
      restoreArray(rows, snapshot as OperationalEvent[]);
    },
  };
}

function outboxStore(): OutboxRepository & MemoryCheckpoint & { rows: OutboxInsertInput[] } {
  const rows: OutboxInsertInput[] = [];
  return {
    rows,
    async insert(input) {
      rows.push(input);
    },
    capture() {
      return rows.map((r) => ({ ...r }));
    },
    restore(snapshot: unknown) {
      restoreArray(rows, snapshot as OutboxInsertInput[]);
    },
  };
}

const TEST_VERSION: OntologyVersion = {
  id: 'ov-writer',
  ontologyId: 'o1',
  versionNumber: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'test',
  contentHash: 'h',
  status: 'COMMITTED',
  objectTypes: {
    'ot.order': { id: 'ot.order', displayName: 'Order', propertyTypeIds: ['status'] },
    'ot.a': { id: 'ot.a', displayName: 'A', propertyTypeIds: [] },
    'ot.b': { id: 'ot.b', displayName: 'B', propertyTypeIds: [] },
  },
  propertyTypes: { status: { id: 'status', displayName: 'Status', baseType: 'string' } },
  linkTypes: {},
  actionTypes: {},
  functionTypes: {},
};

const testVersionPolicy: OntologyVersionPolicy = {
  pin: async () => ({ version: TEST_VERSION }),
};

function harness(authorize: AuthorizeFn = allow) {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const raw = createMemoryObjectRepository({ clock, nextId });
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  // WHY governed: history is written by the governed repository, never by the writer.
  const objects = createGovernedObjectRepository({
    inner: raw,
    versionPolicy: testVersionPolicy,
    history,
    mode: 'enforce',
  });
  const links = createMemoryLinkRepository({
    clock,
    nextId,
    objectExists: async (oid, ot, pk) => Boolean(await objects.get(oid, ot, pk)),
  });
  const events = eventStore();
  const outbox = outboxStore();
  const ledger = createMemoryProjectionLedger();
  const writer = createProjectionWriter({
    objects,
    links,
    events,
    ledger,
    outbox,
    authorize,
    resourceId: 'admin:projection',
    unitOfWork: createSnapshotUnitOfWork([raw, links, events, ledger, outbox, history], () => ({
      objects,
      links,
      events,
      ledger,
      outbox,
    })),
    clock,
  });
  return { objects, links, events, outbox, history, writer };
}

describe('ProjectionWriter', () => {
  it('refuses missing authorize', () => {
    const clock = createDeterministicClock();
    const objects = createMemoryObjectRepository({ clock });
    const links = createMemoryLinkRepository({ clock });
    expect(() =>
      createProjectionWriter({
        objects,
        links,
        events: eventStore(),
        ledger: createMemoryProjectionLedger(),
        authorize: undefined as never,
        resourceId: 'admin:projection',
      }),
    ).toThrow(/authorize/);
  });

  it('authorized projectObject writes object, history, event, outbox once', async () => {
    const { objects, events, outbox, history, writer } = harness();
    const r = await writer.projectObject({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'e1',
      principal: 'svc',
    });
    expect(r.status).toBe('applied');
    expect((await objects.get('o1', 'ot.order', '1'))?.properties.status).toBe('pending');
    expect(events.rows).toHaveLength(1);
    expect(outbox.rows).toHaveLength(1);
    expect(await history.listByObject(r.object!.id)).toHaveLength(1);
  });

  it('replay of sourceEventId returns prior result without extra effects', async () => {
    const { objects, events, outbox, writer } = harness();
    const cmd = {
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'e1',
      principal: 'svc',
    };
    const first = await writer.projectObject(cmd);
    const second = await writer.projectObject(cmd);
    expect(second.status).toBe('replayed');
    expect(second.object?.id).toBe(first.object?.id);
    expect(events.rows).toHaveLength(1);
    expect(outbox.rows).toHaveLength(1);
    expect((await objects.get('o1', 'ot.order', '1'))?.version).toBe(1);
  });

  it('same key with different payload conflicts and writes nothing extra', async () => {
    const { objects, writer } = harness();
    await writer.projectObject({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'e1',
      principal: 'svc',
    });
    await expect(
      writer.projectObject({
        ontologyId: 'o1',
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'other' },
        source: 'erp',
        sourceEventId: 'e1',
        principal: 'svc',
      }),
    ).rejects.toBeInstanceOf(ProjectionConflictError);
    expect((await objects.get('o1', 'ot.order', '1'))?.properties.status).toBe('pending');
  });

  it('denied projection writes nothing and does not reveal existence', async () => {
    const { objects, events, writer } = harness(deny);
    await expect(
      writer.projectObject({
        ontologyId: 'o1',
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'pending' },
        source: 'erp',
        sourceEventId: 'e1',
        principal: 'eve',
      }),
    ).rejects.toBeInstanceOf(ProjectionDeniedError);
    expect(await objects.get('o1', 'ot.order', '1')).toBeUndefined();
    expect(events.rows).toHaveLength(0);
  });

  it('stale expectedVersion writes nothing', async () => {
    const { objects, writer } = harness();
    await writer.projectObject({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'e1',
      principal: 'svc',
    });
    await expect(
      writer.projectObject({
        ontologyId: 'o1',
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'ok' },
        source: 'erp',
        sourceEventId: 'e2',
        principal: 'svc',
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect((await objects.get('o1', 'ot.order', '1'))?.properties.status).toBe('pending');
  });

  it('failure after object write rolls back object and ledger claim', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    const objects = {
      create: async (input: Parameters<typeof inner.create>[0]) => {
        await Promise.resolve(inner.create(input));
        throw new Error('injected after create');
      },
      get: inner.get.bind(inner),
      getById: inner.getById.bind(inner),
      list: inner.list.bind(inner),
      listAll: inner.listAll.bind(inner),
      update: inner.update.bind(inner),
      delete: inner.delete.bind(inner),
    };
    const links = createMemoryLinkRepository({ clock, nextId });
    const events = eventStore();
    const ledger = createMemoryProjectionLedger();
    const writer = createProjectionWriter({
      objects,
      links,
      events,
      ledger,
      authorize: allow,
      resourceId: 'admin:projection',
      unitOfWork: createSnapshotUnitOfWork(
        [inner, links, events, ledger],
        () => ({ objects, links, events, ledger }),
      ),
      clock,
    });
    await expect(
      writer.projectObject({
        ontologyId: 'o1',
        objectTypeId: 'ot.order',
        primaryKey: '1',
        properties: { status: 'pending' },
        source: 'erp',
        sourceEventId: 'e1',
        principal: 'svc',
      }),
    ).rejects.toThrow(/injected after create/);
    expect(await inner.get('o1', 'ot.order', '1')).toBeUndefined();
    const retry = createProjectionWriter({
      objects: inner,
      links,
      events,
      ledger,
      authorize: allow,
      resourceId: 'admin:projection',
      clock,
    });
    const r = await retry.projectObject({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'e1',
      principal: 'svc',
    });
    expect(r.status).toBe('applied');
  });

  it('projectLink + deleteProjectedLink + replay', async () => {
    const { objects, links, writer } = harness();
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.a',
      primaryKey: '1',
    });
    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.b',
      primaryKey: '2',
    });
    const created = await writer.projectLink({
      ontologyId: 'o1',
      linkTypeId: 'lt.ab',
      sourceObjectTypeId: 'ot.a',
      sourcePrimaryKey: '1',
      targetObjectTypeId: 'ot.b',
      targetPrimaryKey: '2',
      source: 'erp',
      sourceEventId: 'l1',
      principal: 'svc',
    });
    expect(created.status).toBe('applied');
    expect(await links.listFrom('o1', 'ot.a', '1', 'lt.ab')).toHaveLength(1);
    const replay = await writer.projectLink({
      ontologyId: 'o1',
      linkTypeId: 'lt.ab',
      sourceObjectTypeId: 'ot.a',
      sourcePrimaryKey: '1',
      targetObjectTypeId: 'ot.b',
      targetPrimaryKey: '2',
      source: 'erp',
      sourceEventId: 'l1',
      principal: 'svc',
    });
    expect(replay.status).toBe('replayed');
    const del = await writer.deleteProjectedLink({
      ontologyId: 'o1',
      linkTypeId: 'lt.ab',
      sourceObjectTypeId: 'ot.a',
      sourcePrimaryKey: '1',
      targetObjectTypeId: 'ot.b',
      targetPrimaryKey: '2',
      source: 'erp',
      sourceEventId: 'l-del',
      principal: 'svc',
    });
    expect(del.status).toBe('applied');
    expect(await links.listFrom('o1', 'ot.a', '1', 'lt.ab')).toHaveLength(0);
  });

  it('concurrent same sourceEventId yields one applied commit', async () => {
    const { objects, events, writer } = harness();
    const cmd = {
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
      source: 'erp',
      sourceEventId: 'conc-1',
      principal: 'svc',
    };
    const [a, b] = await Promise.all([writer.projectObject(cmd), writer.projectObject(cmd)]);
    expect(new Set([a.status, b.status])).toEqual(new Set(['applied', 'replayed']));
    expect(a.object?.id ?? b.object?.id).toBeTruthy();
    expect(a.object?.id && b.object?.id ? a.object.id === b.object.id : true).toBe(true);
    expect(events.rows).toHaveLength(1);
    expect((await objects.get('o1', 'ot.order', '1'))?.version).toBe(1);
  });
});
