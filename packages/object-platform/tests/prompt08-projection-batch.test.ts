/**
 * object-platform — tests/prompt08-projection-batch.test.ts
 *
 * Cases B11–B22: projectBatch atomicity, replay, conflicts, provenance,
 * delete semantics, and provenance updates.
 */

import { describe, expect, it } from 'vitest';

import type {
  AuthorizeFn,
  AuthorizeResult,
  OperationalEvent,
  OperationalEventStore,
} from 'contracts';

import { ProjectionConflictError } from '../src/core/errors.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createGovernedObjectRepository } from '../src/core/governed-object-repository.js';
import { createMemoryLinkRepository } from '../src/core/link-repository.js';
import { type MemoryCheckpoint } from '../src/core/memory-checkpoint.js';
import { createSnapshotUnitOfWork } from '../src/core/memory-transaction-boundary.js';
import { createMemoryObjectHistoryStore } from '../src/core/object-history-store.js';
import { createMemoryObjectRepository } from '../src/core/object-repository.js';
import { createMemoryProjectionLedger } from '../src/core/projection-ledger.js';
import { createProjectionWriter } from '../src/core/projection-writer.js';
import { fixtureOntologyVersion, fixtureVersionPolicy } from './version-policy-fixture.js';

const allow: AuthorizeFn = (): AuthorizeResult => ({
  decision: 'allow',
  principalEpids: ['p'],
  resourceEpid: 'admin:projection',
  reason: 'ok',
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
    async list(opts) {
      if (opts?.kind) return rows.filter((e) => e.kind === opts.kind);
      return [...rows];
    },
    capture() { return { rows: [...rows] }; },
    restore(snap: unknown) {
      rows.length = 0;
      rows.push(...(snap as { rows: OperationalEvent[] }).rows);
    },
  };
}

function makeWriter(opts: {
  authorize?: AuthorizeFn;
  clock?: () => string;
  nextId?: (p: string) => string;
} = {}) {
  const clock = opts.clock ?? createDeterministicClock();
  const nextId = opts.nextId ?? createIdGenerator();
  const raw = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({ clock, nextId });
  const events = eventStore();
  const ledger = createMemoryProjectionLedger();
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  const objects = createGovernedObjectRepository({
    inner: raw,
    versionPolicy: fixtureVersionPolicy(
      fixtureOntologyVersion({
        ontologyId: ONT,
        objectTypes: { 'ot.order': ['status', 'x'], 'ot.item': ['status'] },
        propertyTypes: { x: { id: 'x', displayName: 'x', baseType: 'number' } },
      }),
    ),
    history,
    mode: 'enforce',
  });
  const writer = createProjectionWriter({
    objects,
    links,
    events,
    ledger,
    resourceId: 'admin:projection',
    authorize: opts.authorize ?? allow,
    unitOfWork: createSnapshotUnitOfWork([raw, links, events, ledger, history], () => ({
      objects,
      links,
      events,
      ledger,
    })),
    clock,
  });
  return { writer, objects, links, events, ledger, history, clock, nextId };
}

const ONT = 'test-ont';

// ─── B11: one event → object + two links atomically ─────────────────────────

describe('B11: projectBatch creates object + two links atomically', () => {
  it('applies all effects in one batch', async () => {
    const { writer, objects, links } = makeWriter();
    const result = await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b11',
      principal: 'p',
      effects: [
        {
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.order',
            primaryKey: 'o1',
            properties: { status: 'open' },
            source: 'src',
            sourceEventId: 'evt-b11',
            principal: 'p',
          },
        },
        {
          kind: 'project_link',
          cmd: {
            ontologyId: ONT,
            linkTypeId: 'lt.has',
            sourceObjectTypeId: 'ot.order',
            sourcePrimaryKey: 'o1',
            targetObjectTypeId: 'ot.item',
            targetPrimaryKey: 'i1',
            source: 'src',
            sourceEventId: 'evt-b11',
            principal: 'p',
          },
        },
        {
          kind: 'project_link',
          cmd: {
            ontologyId: ONT,
            linkTypeId: 'lt.has',
            sourceObjectTypeId: 'ot.order',
            sourcePrimaryKey: 'o1',
            targetObjectTypeId: 'ot.item',
            targetPrimaryKey: 'i2',
            source: 'src',
            sourceEventId: 'evt-b11',
            principal: 'p',
          },
        },
      ],
    });
    expect(result.status).toBe('applied');
    expect(result.results).toHaveLength(3);
    expect(await objects.get(ONT, 'ot.order', 'o1')).toBeTruthy();
    const linkList = await links.listFrom(ONT, 'ot.order', 'o1', 'lt.has');
    expect(linkList.length).toBe(2);
  });
});

// ─── B12: replay identical batch does not duplicate history/events ─────────────

describe('B12: replay identical batch does not duplicate effects', () => {
  it('returns replayed status and does not duplicate objects/history', async () => {
    const { writer, objects, events } = makeWriter();
    const cmd = {
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b12',
      principal: 'p',
      effects: [
        {
          kind: 'project_object' as const,
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.order',
            primaryKey: 'o2',
            properties: { status: 'open' },
            source: 'src',
            sourceEventId: 'evt-b12',
            principal: 'p',
          },
        },
      ],
    };
    const first = await writer.projectBatch(cmd);
    expect(first.status).toBe('applied');
    const eventsBefore = (await events.list()).length;
    const second = await writer.projectBatch(cmd);
    expect(second.status).toBe('replayed');
    // No extra events emitted on replay.
    expect((await events.list()).length).toBe(eventsBefore);
    // Object exists exactly once.
    const list = await objects.list(ONT, 'ot.order');
    expect(list.filter((o) => o.primaryKey === 'o2').length).toBe(1);
  });
});

// ─── B13: same event, different property = PROJECTION_CONFLICT ───────────────

describe('B13: same sourceEventId with different property = PROJECTION_CONFLICT', () => {
  it('throws ProjectionConflictError and writes nothing', async () => {
    const { writer, objects } = makeWriter();
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b13',
      principal: 'p',
      effects: [{
        kind: 'project_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'o3',
          properties: { status: 'open' },
          source: 'src',
          sourceEventId: 'evt-b13',
          principal: 'p',
        },
      }],
    });
    const objectsBefore = (await objects.list(ONT, 'ot.order')).length;
    await expect(
      writer.projectBatch({
        source: 'src',
        ontologyId: ONT,
        sourceEventId: 'evt-b13',
        principal: 'p',
        effects: [{
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.order',
            primaryKey: 'o3',
            properties: { status: 'closed' }, // different
            source: 'src',
            sourceEventId: 'evt-b13',
            principal: 'p',
          },
        }],
      }),
    ).rejects.toThrow(ProjectionConflictError);
    expect((await objects.list(ONT, 'ot.order')).length).toBe(objectsBefore);
  });
});

// ─── B14: divergence only in provenance = PROJECTION_CONFLICT ────────────────

describe('B14: same sourceEventId, different provenance = PROJECTION_CONFLICT', () => {
  it('provenance difference triggers conflict', async () => {
    const { writer } = makeWriter();
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b14',
      principal: 'p',
      provenance: { version: 1 },
      effects: [{
        kind: 'project_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'o4',
          properties: {},
          source: 'src',
          sourceEventId: 'evt-b14',
          principal: 'p',
        },
      }],
    });
    await expect(
      writer.projectBatch({
        source: 'src',
        ontologyId: ONT,
        sourceEventId: 'evt-b14',
        principal: 'p',
        provenance: { version: 2 }, // different
        effects: [{
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.order',
            primaryKey: 'o4',
            properties: {},
            source: 'src',
            sourceEventId: 'evt-b14',
            principal: 'p',
          },
        }],
      }),
    ).rejects.toThrow(ProjectionConflictError);
  });
});

// ─── B15: divergence only in effect cardinality = PROJECTION_CONFLICT ────────

describe('B15: divergence in effect list (extra effect) = PROJECTION_CONFLICT', () => {
  it('extra link in second batch conflicts', async () => {
    const { writer } = makeWriter();
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b15',
      principal: 'p',
      effects: [{
        kind: 'project_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'o5',
          properties: {},
          source: 'src',
          sourceEventId: 'evt-b15',
          principal: 'p',
        },
      }],
    });
    await expect(
      writer.projectBatch({
        source: 'src',
        ontologyId: ONT,
        sourceEventId: 'evt-b15',
        principal: 'p',
        effects: [
          {
            kind: 'project_object',
            cmd: {
              ontologyId: ONT,
              objectTypeId: 'ot.order',
              primaryKey: 'o5',
              properties: {},
              source: 'src',
              sourceEventId: 'evt-b15',
              principal: 'p',
            },
          },
          {
            kind: 'project_link', // extra effect
            cmd: {
              ontologyId: ONT,
              linkTypeId: 'lt.has',
              sourceObjectTypeId: 'ot.order',
              sourcePrimaryKey: 'o5',
              targetObjectTypeId: 'ot.item',
              targetPrimaryKey: 'i5',
              source: 'src',
              sourceEventId: 'evt-b15',
              principal: 'p',
            },
          },
        ],
      }),
    ).rejects.toThrow(ProjectionConflictError);
  });
});

// ─── B16: divergence in expectedVersion = PROJECTION_CONFLICT ─────────────────

describe('B16: same sourceEventId, different expectedVersion = PROJECTION_CONFLICT', () => {
  it('expectedVersion difference triggers conflict', async () => {
    const { writer, objects } = makeWriter();
    await objects.create({ ontologyId: ONT, objectTypeId: 'ot.order', primaryKey: 'o6', properties: {} });
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b16',
      principal: 'p',
      effects: [{
        kind: 'project_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'o6',
          properties: { status: 'x' },
          expectedVersion: 1,
          source: 'src',
          sourceEventId: 'evt-b16',
          principal: 'p',
        },
      }],
    });
    await expect(
      writer.projectBatch({
        source: 'src',
        ontologyId: ONT,
        sourceEventId: 'evt-b16',
        principal: 'p',
        effects: [{
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.order',
            primaryKey: 'o6',
            properties: { status: 'x' },
            expectedVersion: 2, // different
            source: 'src',
            sourceEventId: 'evt-b16',
            principal: 'p',
          },
        }],
      }),
    ).rejects.toThrow(ProjectionConflictError);
  });
});

// ─── B18: failure after first effect = integral rollback ─────────────────────

describe('B18: failure after first effect = integral rollback', () => {
  it('no partial state after a mid-batch throw', async () => {
    const { writer, objects } = makeWriter();

    // Simulate failure by attempting a project_link to a bogus ontology + stale expectedVersion.
    // First create the object (version 1), then supply expectedVersion 2 for the update
    // so the second effect throws a VersionConflictError.
    await objects.create({ ontologyId: ONT, objectTypeId: 'ot.order', primaryKey: 'o8pre', properties: {} });

    await expect(
      writer.projectBatch({
        source: 'src',
        ontologyId: ONT,
        sourceEventId: 'evt-b18',
        principal: 'p',
        effects: [
          {
            kind: 'project_object',
            cmd: {
              ontologyId: ONT,
              objectTypeId: 'ot.order',
              primaryKey: 'o8',
              properties: {},
              source: 'src',
              sourceEventId: 'evt-b18',
              principal: 'p',
            },
          },
          {
            kind: 'project_object',
            cmd: {
              ontologyId: ONT,
              objectTypeId: 'ot.order',
              primaryKey: 'o8pre', // already exists at version 1
              properties: { status: 'x' },
              expectedVersion: 99, // stale — triggers VersionConflictError
              source: 'src',
              sourceEventId: 'evt-b18',
              principal: 'p',
            },
          },
        ],
      }),
    ).rejects.toThrow();

    // First effect (create o8) must have been rolled back by the UoW snapshot.
    expect(await objects.get(ONT, 'ot.order', 'o8')).toBeUndefined();
  });
});

// ─── B20: delete non-existent object = no ObjectDeleted event ─────────────────

describe('B20: delete non-existent object does not emit ObjectDeleted', () => {
  it('applies without emitting an event when object does not exist', async () => {
    const { writer, events } = makeWriter();
    const result = await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b20',
      principal: 'p',
      effects: [{
        kind: 'delete_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'nonexistent',
          source: 'src',
          sourceEventId: 'evt-b20',
          principal: 'p',
        },
      }],
    });
    expect(result.status).toBe('applied');
    const deletedEvents = (await events.list()).filter((e) => e.kind === 'ObjectDeleted');
    expect(deletedEvents.length).toBe(0);
  });
});

// ─── B21: new event updates provenance correctly ──────────────────────────────

describe('B21: new event updates provenance on object', () => {
  it('provenance is updated with each new sourceEventId', async () => {
    const { writer, objects } = makeWriter();
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b21-a',
      principal: 'p',
      provenance: { version: 1 },
      effects: [{
        kind: 'project_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'o21',
          properties: { status: 'v1' },
          source: 'src',
          sourceEventId: 'evt-b21-a',
          principal: 'p',
        },
      }],
    });
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'evt-b21-b',
      principal: 'p',
      provenance: { version: 2 },
      effects: [{
        kind: 'project_object',
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.order',
          primaryKey: 'o21',
          properties: { status: 'v2' },
          source: 'src',
          sourceEventId: 'evt-b21-b',
          principal: 'p',
        },
      }],
    });
    const obj = await objects.get(ONT, 'ot.order', 'o21');
    expect(obj?.properties.status).toBe('v2');
    expect(obj?.provenance?.sourceEventId).toBe('evt-b21-b');
    expect(obj?.provenance?.version).toBe(2);
  });
});

// ─── Singular methods delegate to projectBatch ───────────────────────────────

describe('singular projectObject/projectLink still work', () => {
  it('projectObject result is applied', async () => {
    const { writer, objects } = makeWriter();
    const r = await writer.projectObject({
      ontologyId: ONT,
      objectTypeId: 'ot.order',
      primaryKey: 'sing',
      properties: { x: 1 },
      source: 'src',
      sourceEventId: 'sing-1',
      principal: 'p',
    });
    expect(r.status).toBe('applied');
    expect(await objects.get(ONT, 'ot.order', 'sing')).toBeTruthy();
  });
});
