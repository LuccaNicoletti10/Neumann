/**
 * object-platform — tests/prompt08d-projection-schema.test.ts
 *
 * Memory proofs: object schema on a pinned OntologyVersion during projectBatch.
 * Invalid cases write zero ledger / objects / links / history / events / audit / outbox.
 */

import { describe, expect, it } from 'vitest';

import type {
  AuditEntry,
  AuditLog,
  AuthorizeFn,
  AuthorizeResult,
  OntologyRegistry,
  OntologyVersion,
  OperationalEvent,
  OperationalEventStore,
  OutboxInsertInput,
  OutboxRepository,
} from 'contracts';

import { OntologyValidationError } from '../src/core/errors.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createGovernedObjectRepository } from '../src/core/governed-object-repository.js';
import { createMemoryLinkRepository } from '../src/core/link-repository.js';
import { type MemoryCheckpoint } from '../src/core/memory-checkpoint.js';
import { createSnapshotUnitOfWork } from '../src/core/memory-transaction-boundary.js';
import { createMemoryObjectHistoryStore } from '../src/core/object-history-store.js';
import { createMemoryObjectRepository } from '../src/core/object-repository.js';
import { createMemoryProjectionLedger } from '../src/core/projection-ledger.js';
import { createProjectionWriter } from '../src/core/projection-writer.js';

const ONT = 'ont-schema';
const allow: AuthorizeFn = (): AuthorizeResult => ({
  decision: 'allow',
  principalEpids: ['p'],
  resourceEpid: 'admin:projection',
  reason: 'ok',
});

function pinnedVersion(): OntologyVersion {
  return {
    id: 'ov-pin-1',
    ontologyId: ONT,
    versionNumber: 1,
    createdAt: 't0',
    createdBy: 'test',
    contentHash: 'h1',
    status: 'COMMITTED',
    objectTypes: {
      'ot.item': {
        id: 'ot.item',
        displayName: 'Item',
        propertyTypeIds: ['name', 'qty', 'note'],
      },
    },
    propertyTypes: {
      name: {
        id: 'name',
        displayName: 'Name',
        baseType: 'string',
        validators: [{ kind: 'required' }],
      },
      qty: { id: 'qty', displayName: 'Qty', baseType: 'number' },
      note: { id: 'note', displayName: 'Note', baseType: 'string' },
    },
    linkTypes: {},
    actionTypes: {},
    functionTypes: {},
  };
}

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
      return [...rows];
    },
    capture() {
      return { rows: [...rows] };
    },
    restore(snap: unknown) {
      rows.length = 0;
      rows.push(...(snap as { rows: OperationalEvent[] }).rows);
    },
  };
}

function makeHarness() {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const version = pinnedVersion();
  let latestCalls = 0;
  const ontology = {
    getLatestVersion: async () => {
      latestCalls += 1;
      return version;
    },
  } as Pick<OntologyRegistry, 'getLatestVersion'> as OntologyRegistry;

  const raw = createMemoryObjectRepository({ clock, nextId });
  const links = createMemoryLinkRepository({ clock, nextId });
  const events = eventStore();
  const ledger = createMemoryProjectionLedger();
  const history = createMemoryObjectHistoryStore({ clock, nextId });
  const objects = createGovernedObjectRepository({
    inner: raw,
    versionPolicy: { pin: async () => ({ version }) },
    history,
    mode: 'enforce',
  });
  const auditEntries: string[] = [];
  // WHY checkpointable: audit is a store of the unit of work. A rollback that
  // leaves an audit row for a mutation that never happened is a false trail.
  const audit: AuditLog & MemoryCheckpoint = {
    async append(eventData: string) {
      auditEntries.push(eventData);
      return { id: String(auditEntries.length) } as AuditEntry;
    },
    capture() {
      return [...auditEntries];
    },
    restore(snapshot: unknown) {
      auditEntries.length = 0;
      auditEntries.push(...(snapshot as string[]));
    },
  } as AuditLog & MemoryCheckpoint;
  const outboxRows: OutboxInsertInput[] = [];
  const outbox: OutboxRepository & MemoryCheckpoint & { rows: OutboxInsertInput[] } = {
    rows: outboxRows,
    async insert(input) {
      outboxRows.push(input);
    },
    capture() {
      return outboxRows.map((r) => ({ ...r }));
    },
    restore(snapshot: unknown) {
      outboxRows.length = 0;
      outboxRows.push(...(snapshot as OutboxInsertInput[]));
    },
  };

  const writer = createProjectionWriter({
    objects,
    links,
    events,
    ledger,
    audit,
    outbox,
    ontology,
    resourceId: 'admin:projection',
    authorize: allow,
    unitOfWork: createSnapshotUnitOfWork(
      [raw, links, events, ledger, history, outbox, audit],
      () => ({
        objects,
        links,
        events,
        ledger,
        audit,
        outbox,
      }),
    ),
    clock,
  });

  function snapshot() {
    return {
      ledger: (ledger.capture() as { rows: Map<string, unknown> }).rows.size,
      objects: (raw.capture() as { byId: Map<string, unknown> }).byId.size,
      links: (links.capture() as { byId: Map<string, unknown> }).byId.size,
      history: (history.capture() as unknown[]).length,
      events: events.rows.length,
      audit: auditEntries.length,
      outbox: outboxRows.length,
    };
  }

  return { writer, snapshot, latestCalls: () => latestCalls, version };
}

function batch(sourceEventId: string, properties: Record<string, unknown>) {
  return {
    source: 'src',
    ontologyId: ONT,
    sourceEventId,
    principal: 'p',
    effects: [
      {
        kind: 'project_object' as const,
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.item',
          primaryKey: 'seed-ok',
          properties: { name: 'ok', qty: 1 },
          source: 'src',
          sourceEventId,
          principal: 'p',
        },
      },
      {
        kind: 'project_object' as const,
        cmd: {
          ontologyId: ONT,
          objectTypeId: 'ot.item',
          primaryKey: 'bad',
          properties,
          source: 'src',
          sourceEventId,
          principal: 'p',
        },
      },
    ],
  };
}

describe('Prompt 08D — object schema in projection batch (memory)', () => {
  it('pins getLatestVersion once for the whole batch', async () => {
    const { writer, latestCalls } = makeHarness();
    await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'pin-ok',
      principal: 'p',
      effects: [
        {
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.item',
            primaryKey: 'a',
            properties: { name: 'n', qty: 1 },
            source: 'src',
            sourceEventId: 'pin-ok',
            principal: 'p',
          },
        },
        {
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.item',
            primaryKey: 'b',
            properties: { name: 'm', qty: 2, note: null },
            source: 'src',
            sourceEventId: 'pin-ok',
            principal: 'p',
          },
        },
      ],
    });
    expect(latestCalls()).toBe(1);
  });

  it('required ausente → zero ledger/objects/links/history/events/audit/outbox', async () => {
    const { writer, snapshot } = makeHarness();
    const before = snapshot();
    await expect(writer.projectBatch(batch('req-missing', { qty: 1 }))).rejects.toBeInstanceOf(
      OntologyValidationError,
    );
    expect(snapshot()).toEqual(before);
  });

  it('baseType incorreto → zero side effects', async () => {
    const { writer, snapshot } = makeHarness();
    const before = snapshot();
    await expect(
      writer.projectBatch(batch('bad-type', { name: 'n', qty: 'nope' })),
    ).rejects.toBeInstanceOf(OntologyValidationError);
    expect(snapshot()).toEqual(before);
  });

  it('null quando nullable=false → zero side effects', async () => {
    const { writer, snapshot } = makeHarness();
    const before = snapshot();
    await expect(
      writer.projectBatch(batch('null-required', { name: null, qty: 1 })),
    ).rejects.toBeInstanceOf(OntologyValidationError);
    expect(snapshot()).toEqual(before);
  });

  it('null permitido quando nullable=true', async () => {
    const { writer, snapshot } = makeHarness();
    const result = await writer.projectBatch({
      source: 'src',
      ontologyId: ONT,
      sourceEventId: 'null-ok',
      principal: 'p',
      effects: [
        {
          kind: 'project_object',
          cmd: {
            ontologyId: ONT,
            objectTypeId: 'ot.item',
            primaryKey: 'n1',
            properties: { name: 'n', qty: 1, note: null },
            source: 'src',
            sourceEventId: 'null-ok',
            principal: 'p',
          },
        },
      ],
    });
    expect(result.status).toBe('applied');
    const after = snapshot();
    expect(after.objects).toBe(1);
    expect(after.ledger).toBe(1);
  });

  it('propriedade desconhecida → zero side effects', async () => {
    const { writer, snapshot } = makeHarness();
    const before = snapshot();
    await expect(
      writer.projectBatch(batch('unknown-prop', { name: 'n', qty: 1, extra: true })),
    ).rejects.toBeInstanceOf(OntologyValidationError);
    expect(snapshot()).toEqual(before);
  });
});
