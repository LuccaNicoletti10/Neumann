/**
 * platform-api — tests/governed-storage-contract.ts
 *
 * One governed-storage contract, executed against memory and PostgreSQL.
 *
 * WHY no history.append() here: history is an effect of a governed mutation.
 * A suite that writes it by hand proves the test, not the platform.
 *
 * The only adapter-specific input is `reopen` (process restart over the same
 * durable schema). Rules are identical.
 */
import { expect } from 'vitest';

import { LinkIntegrityError, OntologyValidationError, VersionConflictError } from 'object-platform';

import type { PlatformContext } from '../src/core/context.js';

export interface GovernedContractHarness {
  ctx: PlatformContext;
  /** Reopen the same durable storage in a fresh context. Memory omits this. */
  reopen?: () => Promise<PlatformContext>;
}

const ITEM = 'ot.item';
const PEER = 'ot.peer';
const REL = 'lt.rel';
const CARD = 'lt.card';

/** Normalise the observable shape: only ids and timestamps may differ. */
interface NormalisedHistory {
  operation: string;
  version: number;
  deleted: boolean;
  properties: Record<string, unknown>;
  principal?: string;
  hasProvenance: boolean;
}

function normaliseHistory(entries: readonly {
  operation: string;
  version: number;
  deleted: boolean;
  properties: Record<string, unknown>;
  principal?: string;
  provenance?: Record<string, unknown>;
}[]): NormalisedHistory[] {
  return entries
    .slice()
    .sort((a, b) => a.version - b.version)
    .map((e) => ({
      operation: e.operation,
      version: e.version,
      deleted: e.deleted,
      properties: e.properties,
      principal: e.principal,
      hasProvenance: e.provenance !== undefined && Object.keys(e.provenance).length > 0,
    }));
}

export async function seedGovernedOntology(ctx: PlatformContext): Promise<string> {
  const o = await ctx.ontology.createOntology({ name: 'governed-contract' });
  for (const [id, baseType] of [
    ['n', 'string'],
    ['qty', 'number'],
  ] as const) {
    await ctx.ontology.addPropertyType(o.id, { id, displayName: id, baseType });
  }
  await ctx.ontology.addObjectType(o.id, {
    id: ITEM,
    displayName: 'Item',
    propertyTypeIds: ['n', 'qty'],
  });
  await ctx.ontology.addObjectType(o.id, { id: PEER, displayName: 'Peer', propertyTypeIds: ['n'] });
  await ctx.ontology.addLinkType(o.id, {
    id: REL,
    displayName: 'Rel',
    sourceObjectTypeId: ITEM,
    targetObjectTypeId: PEER,
    cardinality: 'N:N',
  });
  await ctx.ontology.addLinkType(o.id, {
    id: CARD,
    displayName: 'Card',
    sourceObjectTypeId: ITEM,
    targetObjectTypeId: PEER,
    cardinality: 'N:1',
  });
  await ctx.ontology.addActionType(o.id, {
    id: 'act.rename',
    apiName: 'rename',
    displayName: 'Rename',
    inputObjectTypeIds: [ITEM],
    parameters: {
      itemId: { baseType: 'object_reference' as const, objectTypeId: ITEM, required: true },
      n: { baseType: 'string' as const, required: true },
    },
    rules: [
      {
        kind: 'modify_object' as const,
        objectTypeId: ITEM,
        primaryKeyFromParam: 'itemId',
        setPropertiesFromParams: { n: 'n' },
      },
    ],
    sideEffects: [
      { kind: 'connector_writeback' as const, connectorId: 'erp', operation: 'upsert' },
    ],
  });
  await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'contract' });
  return o.id;
}

function projectItem(
  ctx: PlatformContext,
  ontologyId: string,
  primaryKey: string,
  properties: Record<string, unknown>,
  sourceEventId: string,
) {
  return ctx.projections.projectObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey,
    properties,
    source: 'erp',
    sourceEventId,
    principal: 'svc',
    provenance: { batch: sourceEventId },
  });
}

export async function runGovernedStorageContract(h: GovernedContractHarness): Promise<void> {
  const { ctx } = h;
  const ontologyId = await seedGovernedOntology(ctx);

  // ── create → history create, with provenance ──────────────────────────────
  const created = await projectItem(ctx, ontologyId, 'A', { n: 'one', qty: 1 }, 'evt-create');
  const objectId = created.object!.id;
  expect(created.object?.version).toBe(1);
  expect(created.object?.provenance?.sourceEventId).toBe('evt-create');
  expect(normaliseHistory(await ctx.history.listByObject(objectId))).toEqual([
    {
      operation: 'create',
      version: 1,
      deleted: false,
      properties: { n: 'one', qty: 1 },
      principal: 'svc',
      hasProvenance: true,
    },
  ]);

  // ── undeclared property is refused by the same rule in both adapters ──────
  await expect(
    ctx.projections.projectObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'A',
      properties: { nope: 'x' },
      source: 'erp',
      sourceEventId: 'evt-undeclared',
      principal: 'svc',
    }),
  ).rejects.toBeInstanceOf(OntologyValidationError);

  // ── update → history update ───────────────────────────────────────────────
  await projectItem(ctx, ontologyId, 'A', { n: 'two', qty: 2 }, 'evt-update');
  expect(normaliseHistory(await ctx.history.listByObject(objectId)).map((e) => e.operation)).toEqual(
    ['create', 'update'],
  );

  // ── CAS stale ─────────────────────────────────────────────────────────────
  await expect(
    ctx.objects.update(ontologyId, ITEM, 'A', { properties: { n: 'stale', qty: 2 }, expectedVersion: 1 }),
  ).rejects.toBeInstanceOf(VersionConflictError);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.properties.n).toBe('two');

  // ── link endpoint that does not exist ─────────────────────────────────────
  await ctx.projections.projectObject({
    ontologyId,
    objectTypeId: PEER,
    primaryKey: 'P1',
    properties: { n: 'p1' },
    source: 'erp',
    sourceEventId: 'evt-peer-1',
    principal: 'svc',
  });
  await ctx.projections.projectObject({
    ontologyId,
    objectTypeId: PEER,
    primaryKey: 'P2',
    properties: { n: 'p2' },
    source: 'erp',
    sourceEventId: 'evt-peer-2',
    principal: 'svc',
  });
  await expect(
    ctx.links.create({
      ontologyId,
      linkTypeId: REL,
      sourceObjectTypeId: ITEM,
      sourcePrimaryKey: 'MISSING',
      targetObjectTypeId: PEER,
      targetPrimaryKey: 'P1',
    }),
  ).rejects.toBeInstanceOf(LinkIntegrityError);

  // ── cardinality comes from the pinned ontology version ────────────────────
  await ctx.links.create({
    ontologyId,
    linkTypeId: CARD,
    sourceObjectTypeId: ITEM,
    sourcePrimaryKey: 'A',
    targetObjectTypeId: PEER,
    targetPrimaryKey: 'P1',
  });
  await expect(
    ctx.links.create({
      ontologyId,
      linkTypeId: CARD,
      sourceObjectTypeId: ITEM,
      sourcePrimaryKey: 'A',
      targetObjectTypeId: PEER,
      targetPrimaryKey: 'P2',
    }),
  ).rejects.toThrow(/cardinality N:1/);

  // ── link CAS ──────────────────────────────────────────────────────────────
  const rel = await ctx.links.create({
    ontologyId,
    linkTypeId: REL,
    sourceObjectTypeId: ITEM,
    sourcePrimaryKey: 'A',
    targetObjectTypeId: PEER,
    targetPrimaryKey: 'P1',
  });
  expect(rel.version).toBe(1);
  await expect(
    ctx.links.delete(ontologyId, REL, ITEM, 'A', PEER, 'P1', { expectedVersion: 99 }),
  ).rejects.toBeInstanceOf(VersionConflictError);
  expect(await ctx.links.listFrom(ontologyId, ITEM, 'A', REL)).toHaveLength(1);

  // ── Action mutation → history/event/audit/outbox exactly once ─────────────
  const beforeAction = {
    history: (await ctx.history.listByObject(objectId)).length,
    audit: (await ctx.audit.list()).length,
    outbox: (await ctx.outbox.listRequests({ topic: 'action.side_effect.writeback' })).length,
  };
  const applied = await ctx.actions.apply({
    ontologyId,
    actionApiName: 'rename',
    parameters: { itemId: 'A', n: 'renamed' },
    principal: 'alice',
    idempotencyKey: 'rename-1',
    expectedObjectVersions: { [`${ITEM}::A`]: 2 },
  });
  expect(applied.status).toBe('SUCCEEDED');
  expect((await ctx.history.listByObject(objectId)).length).toBe(beforeAction.history + 1);
  expect((await ctx.audit.list()).length).toBeGreaterThan(beforeAction.audit);
  expect(
    (await ctx.outbox.listRequests({ topic: 'action.side_effect.writeback' })).length,
  ).toBe(beforeAction.outbox + 1);
  const replay = await ctx.actions.apply({
    ontologyId,
    actionApiName: 'rename',
    parameters: { itemId: 'A', n: 'renamed' },
    principal: 'alice',
    idempotencyKey: 'rename-1',
    expectedObjectVersions: { [`${ITEM}::A`]: 2 },
  });
  expect(replay.executionId).toBe(applied.executionId);
  expect((await ctx.history.listByObject(objectId)).length).toBe(beforeAction.history + 1);
  expect(
    (await ctx.outbox.listRequests({ topic: 'action.side_effect.writeback' })).length,
  ).toBe(beforeAction.outbox + 1);

  // ── ProjectionBatch → same observable effects, rollback on failure ────────
  const beforeBatch = {
    history: (await ctx.history.listByObject(objectId)).length,
    outbox: (await ctx.outbox.listRequests({ topic: 'projection.applied' })).length,
  };
  await ctx.projections.projectBatch({
    source: 'erp',
    ontologyId,
    sourceEventId: 'evt-batch',
    principal: 'svc',
    effects: [
      {
        kind: 'project_object',
        cmd: {
          ontologyId,
          objectTypeId: ITEM,
          primaryKey: 'A',
          properties: { n: 'batched', qty: 9 },
          source: 'erp',
          sourceEventId: 'evt-batch',
          principal: 'svc',
        },
      },
      {
        kind: 'project_object',
        cmd: {
          ontologyId,
          objectTypeId: PEER,
          primaryKey: 'P3',
          properties: { n: 'p3' },
          source: 'erp',
          sourceEventId: 'evt-batch',
          principal: 'svc',
        },
      },
    ],
  });
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.properties.n).toBe('batched');
  expect((await ctx.history.listByObject(objectId)).length).toBe(beforeBatch.history + 1);
  expect((await ctx.outbox.listRequests({ topic: 'projection.applied' })).length).toBe(
    beforeBatch.outbox + 2,
  );

  const versionBeforeRollback = (await ctx.objects.get(ontologyId, ITEM, 'A'))!.version;
  const historyBeforeRollback = (await ctx.history.listByObject(objectId)).length;
  await expect(
    ctx.projections.projectBatch({
      source: 'erp',
      ontologyId,
      sourceEventId: 'evt-batch-fail',
      principal: 'svc',
      effects: [
        {
          kind: 'project_object',
          cmd: {
            ontologyId,
            objectTypeId: ITEM,
            primaryKey: 'A',
            properties: { n: 'ghost', qty: 0 },
            source: 'erp',
            sourceEventId: 'evt-batch-fail',
            principal: 'svc',
          },
        },
        {
          kind: 'delete_object',
          cmd: {
            ontologyId,
            objectTypeId: ITEM,
            primaryKey: 'A',
            source: 'erp',
            sourceEventId: 'evt-batch-fail',
            principal: 'svc',
            expectedVersion: 4242,
          },
        },
      ],
    }),
  ).rejects.toBeInstanceOf(VersionConflictError);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.version).toBe(versionBeforeRollback);
  expect((await ctx.history.listByObject(objectId)).length).toBe(historyBeforeRollback);

  // ── delete → history delete, soft-delete then revive ─────────────────────
  const deleted = await ctx.projections.deleteProjectedObject({
    ontologyId,
    objectTypeId: PEER,
    primaryKey: 'P3',
    source: 'erp',
    sourceEventId: 'evt-del-p3',
    principal: 'svc',
  });
  const peerId = deleted.object!.id;
  expect(await ctx.objects.get(ontologyId, PEER, 'P3')).toBeUndefined();
  expect(await ctx.objects.getById(peerId)).toBeUndefined();
  const peerTrail = normaliseHistory(await ctx.history.listByObject(peerId));
  expect(peerTrail.map((e) => e.operation)).toEqual(['create', 'delete']);
  expect(peerTrail.at(-1)?.deleted).toBe(true);

  const revived = await ctx.projections.projectObject({
    ontologyId,
    objectTypeId: PEER,
    primaryKey: 'P3',
    properties: { n: 'p3-again' },
    source: 'erp',
    sourceEventId: 'evt-revive-p3',
    principal: 'svc',
  });
  // WHY the same row: revive keeps identity and continues the version chain.
  expect(revived.object?.id).toBe(peerId);
  expect(revived.object?.deleted).toBe(false);
  expect(revived.object!.version).toBeGreaterThan(peerTrail.at(-1)!.version);

  // ── restart preserves object identity, version and history ───────────────
  if (h.reopen) {
    const again = await h.reopen();
    const live = await again.objects.get(ontologyId, ITEM, 'A');
    expect(live?.id).toBe(objectId);
    expect(live?.version).toBe(versionBeforeRollback);
    expect(live?.ontologyVersionId).toBe(
      (await ctx.objects.get(ontologyId, ITEM, 'A'))?.ontologyVersionId,
    );
    expect(normaliseHistory(await again.history.listByObject(objectId))).toEqual(
      normaliseHistory(await ctx.history.listByObject(objectId)),
    );
  }
}
