/**
 * platform-api — tests/ontology-evolution.ts
 *
 * PROMPT 09 items 4–6, cases 11–22, as one suite run on memory and PostgreSQL.
 *
 * WHY shared: "an object never changes schema implicitly" is an invariant of the
 * kernel, not of an adapter. Two copies of these rules would let the adapters
 * drift silently.
 */
import type { PropertyTypeDef } from 'contracts';
import { expect } from 'vitest';

import {
  ObjectNotFoundError,
  OntologyValidationError,
  OntologyVersionMismatchError,
  VersionConflictError,
  classifyOntologyChange,
} from 'object-platform';

import type { PlatformContext } from '../src/core/context.js';

export interface EvolutionHarness {
  ctx: PlatformContext;
  /** Reopen the same durable storage in a fresh context. Memory omits this. */
  reopen?: () => Promise<PlatformContext>;
}

const ITEM = 'ot.item';

/**
 * Add one property to the existing ITEM type in a fresh draft.
 * WHY draft mutation: `addObjectType` refuses an id that the draft already
 * carries, and the registry exposes no "replace type" verb. Both adapters keep
 * the open draft in process and clone it at commit, so this is the same edit.
 */
async function declareOnItem(
  ctx: PlatformContext,
  ontologyId: string,
  def: PropertyTypeDef,
): Promise<void> {
  await ctx.ontology.openDraft(ontologyId);
  await ctx.ontology.addPropertyType(ontologyId, def);
  const draft = await ctx.ontology.getDraft(ontologyId);
  draft!.objectTypes[ITEM]!.propertyTypeIds.push(def.id);
}

export interface SeededEvolution {
  ontologyId: string;
  v1: string;
}

/** v1: {n, qty} plus an Action that writes a property v1 does not declare. */
export async function seedEvolvingOntology(ctx: PlatformContext): Promise<SeededEvolution> {
  const o = await ctx.ontology.createOntology({ name: 'evolution' });
  await ctx.ontology.addPropertyType(o.id, { id: 'n', displayName: 'n', baseType: 'string' });
  await ctx.ontology.addPropertyType(o.id, { id: 'qty', displayName: 'qty', baseType: 'number' });
  await ctx.ontology.addObjectType(o.id, {
    id: ITEM,
    displayName: 'Item',
    propertyTypeIds: ['n', 'qty'],
  });
  await ctx.ontology.addActionType(o.id, {
    id: 'act.note',
    apiName: 'note',
    displayName: 'Note',
    inputObjectTypeIds: [ITEM],
    parameters: {
      itemId: { baseType: 'object_reference' as const, objectTypeId: ITEM, required: true },
      note: { baseType: 'string' as const, required: true },
    },
    rules: [
      {
        kind: 'modify_object' as const,
        objectTypeId: ITEM,
        primaryKeyFromParam: 'itemId',
        setPropertiesFromParams: { note: 'note' },
      },
    ],
  });
  const v1 = await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  return { ontologyId: o.id, v1: v1.id };
}

export async function runOntologyEvolutionContract(h: EvolutionHarness): Promise<void> {
  const { ctx } = h;
  const { ontologyId, v1 } = await seedEvolvingOntology(ctx);

  // 11. an object created under v1 stays on v1 after v2 is published.
  await ctx.projections.projectObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'A',
    properties: { n: 'one', qty: 1 },
    source: 'erp',
    sourceEventId: 'evt-create-a',
    principal: 'svc',
  });
  // B and C are created under v1 too; they carry the later migration proofs.
  for (const [primaryKey, qty] of [
    ['B', 5],
    ['C', 7],
  ] as const) {
    await ctx.projections.projectObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey,
      properties: { n: primaryKey.toLowerCase(), qty },
      source: 'erp',
      sourceEventId: `evt-create-${primaryKey}`,
      principal: 'svc',
    });
  }
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.ontologyVersionId).toBe(v1);

  await declareOnItem(ctx, ontologyId, { id: 'note', displayName: 'note', baseType: 'string' });
  const v2 = (await ctx.ontology.commit({ ontologyId, createdBy: 'test' })).id;
  expect((await ctx.ontology.getLatestVersion(ontologyId))?.id).toBe(v2);
  const afterPublish = await ctx.objects.get(ontologyId, ITEM, 'A');
  expect(afterPublish?.ontologyVersionId).toBe(v1);

  // 12. a plain update validates against v1, the version of record.
  await ctx.projections.projectObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'A',
    properties: { n: 'two', qty: 2 },
    source: 'erp',
    sourceEventId: 'evt-update-a',
    principal: 'svc',
  });
  const updated = await ctx.objects.get(ontologyId, ITEM, 'A');
  expect(updated?.ontologyVersionId).toBe(v1);
  expect(updated?.properties.n).toBe('two');

  // 13. a property that exists only in v2 is refused on a v1 object.
  await expect(
    ctx.projections.projectObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'A',
      properties: { n: 'two', qty: 2, note: 'v2 only' },
      source: 'erp',
      sourceEventId: 'evt-v2-field-on-v1',
      principal: 'svc',
    }),
  ).rejects.toBeInstanceOf(OntologyValidationError);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.properties.note).toBeUndefined();

  // 22. an Action pinned to v2 cannot silently write a v2 field on a v1 object.
  const actionOnV1 = await ctx.actions.apply({
    ontologyId,
    actionApiName: 'note',
    parameters: { itemId: 'A', note: 'from action' },
    principal: 'alice',
    idempotencyKey: 'note-on-v1',
    ontologyVersionId: v2,
  });
  expect(actionOnV1.status).toBe('FAILED');
  expect(actionOnV1.error ?? '').toMatch(/note|version/i);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.properties.note).toBeUndefined();
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.ontologyVersionId).toBe(v1);

  // 15. a breaking target without a transformation fails. `strict` requires
  // `code`, which no v1 object carries.
  await declareOnItem(ctx, ontologyId, {
    id: 'code',
    displayName: 'code',
    baseType: 'string',
    validators: [{ kind: 'required' }],
  });
  const v3 = (await ctx.ontology.commit({ ontologyId, createdBy: 'test' })).id;
  const breaking = classifyOntologyChange(
    (await ctx.ontology.getVersion(v1))!,
    (await ctx.ontology.getVersion(v3))!,
  );
  expect(breaking.class).toBe('breaking');

  const atV1 = (await ctx.objects.get(ontologyId, ITEM, 'A'))!;
  await expect(
    ctx.projections.migrateObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'A',
      fromVersionId: v1,
      toVersionId: v3,
      expectedObjectVersion: atV1.version,
      transformedProperties: { n: atV1.properties.n, qty: atV1.properties.qty },
      principal: 'admin',
      idempotencyKey: 'mig-a-v3-untransformed',
    }),
  ).rejects.toBeInstanceOf(OntologyValidationError);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.ontologyVersionId).toBe(v1);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.version).toBe(atV1.version);

  // 16. the same migration with the missing value supplied passes.
  const migratedToV3 = await ctx.projections.migrateObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'A',
    fromVersionId: v1,
    toVersionId: v3,
    expectedObjectVersion: atV1.version,
    transformedProperties: { n: atV1.properties.n, qty: atV1.properties.qty, code: 'A-1' },
    principal: 'admin',
    idempotencyKey: 'mig-a-v3',
  });
  expect(migratedToV3.status).toBe('applied');
  expect(migratedToV3.object?.ontologyVersionId).toBe(v3);
  expect(migratedToV3.object?.version).toBe(atV1.version + 1);

  // history carries both endpoints of the move.
  const trail = await ctx.history.listByObject(migratedToV3.object!.id);
  const migrationEntry = trail.find((e) => e.toOntologyVersionId === v3);
  expect(migrationEntry?.fromOntologyVersionId).toBe(v1);
  expect(migrationEntry?.operation).toBe('update');

  // 18. identical replay is idempotent: same result, no second effect.
  const historyLen = (await ctx.history.listByObject(migratedToV3.object!.id)).length;
  const replay = await ctx.projections.migrateObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'A',
    fromVersionId: v1,
    toVersionId: v3,
    expectedObjectVersion: atV1.version,
    transformedProperties: { n: atV1.properties.n, qty: atV1.properties.qty, code: 'A-1' },
    principal: 'admin',
    idempotencyKey: 'mig-a-v3',
  });
  expect(replay.status).toBe('replayed');
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.version).toBe(atV1.version + 1);
  expect((await ctx.history.listByObject(migratedToV3.object!.id)).length).toBe(historyLen);

  // 19. same key with a divergent payload is a conflict, not a second write.
  await expect(
    ctx.projections.migrateObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'A',
      fromVersionId: v1,
      toVersionId: v3,
      expectedObjectVersion: atV1.version,
      transformedProperties: { n: atV1.properties.n, qty: atV1.properties.qty, code: 'DIFFERENT' },
      principal: 'admin',
      idempotencyKey: 'mig-a-v3',
    }),
  ).rejects.toThrow(/conflict/i);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.properties.code).toBe('A-1');

  // A stale declared source names both versions instead of only complaining
  // about an undeclared property.
  await expect(
    ctx.projections.migrateObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'A',
      fromVersionId: v1,
      toVersionId: v2,
      expectedObjectVersion: atV1.version + 1,
      transformedProperties: { n: 'x', qty: 1 },
      principal: 'admin',
      idempotencyKey: 'mig-a-wrong-source',
    }),
  ).rejects.toBeInstanceOf(OntologyVersionMismatchError);

  // 14. an additive v1→v2 migration passes on a second object.
  const b = (await ctx.objects.get(ontologyId, ITEM, 'B'))!;
  expect(b.ontologyVersionId).toBe(v1);
  expect(
    classifyOntologyChange(
      (await ctx.ontology.getVersion(v1))!,
      (await ctx.ontology.getVersion(v2))!,
    ).class,
  ).toBe('additive-compatible');
  const bMigrated = await ctx.projections.migrateObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'B',
    fromVersionId: v1,
    toVersionId: v2,
    expectedObjectVersion: b.version,
    transformedProperties: { n: 'b', qty: 5 },
    principal: 'admin',
    idempotencyKey: 'mig-b-v2',
  });
  expect(bMigrated.object?.ontologyVersionId).toBe(v2);
  // The v2 field is now writable on B and still refused on a v1 object.
  await ctx.projections.projectObject({
    ontologyId,
    objectTypeId: ITEM,
    primaryKey: 'B',
    properties: { n: 'b', qty: 5, note: 'allowed now' },
    source: 'erp',
    sourceEventId: 'evt-b-note',
    principal: 'svc',
  });
  expect((await ctx.objects.get(ontologyId, ITEM, 'B'))?.properties.note).toBe('allowed now');

  // 17. two concurrent migrations of one object: exactly one winner.
  const c = (await ctx.objects.get(ontologyId, ITEM, 'C'))!;
  const race = (key: string) =>
    ctx.projections.migrateObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'C',
      fromVersionId: v1,
      toVersionId: v2,
      expectedObjectVersion: c.version,
      transformedProperties: { n: 'c', qty: 7 },
      principal: 'admin',
      idempotencyKey: key,
    });
  const outcomes = await Promise.allSettled([race('mig-c-1'), race('mig-c-2')]);
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);
  const afterRace = (await ctx.objects.get(ontologyId, ITEM, 'C'))!;
  expect(afterRace.version).toBe(c.version + 1);
  expect(afterRace.ontologyVersionId).toBe(v2);

  // Migration is not a create: an unknown object is not written into existence.
  await expect(
    ctx.projections.migrateObject({
      ontologyId,
      objectTypeId: ITEM,
      primaryKey: 'MISSING',
      fromVersionId: v1,
      toVersionId: v2,
      expectedObjectVersion: 1,
      transformedProperties: { n: 'x', qty: 0 },
      principal: 'admin',
      idempotencyKey: 'mig-missing',
    }),
  ).rejects.toBeInstanceOf(ObjectNotFoundError);
  expect(await ctx.objects.get(ontologyId, ITEM, 'MISSING')).toBeUndefined();

  // 21. rolling `latest` back does not rewrite objects, migrated or not.
  const rolled = await ctx.ontology.rollback(ontologyId, v1, 'test');
  expect((await ctx.ontology.getLatestVersion(ontologyId))?.id).toBe(rolled.id);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.ontologyVersionId).toBe(v3);
  expect((await ctx.objects.get(ontologyId, ITEM, 'B'))?.ontologyVersionId).toBe(v2);
  expect((await ctx.objects.get(ontologyId, ITEM, 'C'))?.ontologyVersionId).toBe(v2);
  expect((await ctx.objects.get(ontologyId, ITEM, 'A'))?.properties.code).toBe('A-1');

  // 20. restart preserves the stamped version and the migration history.
  if (h.reopen) {
    const again = await h.reopen();
    const a = await again.objects.get(ontologyId, ITEM, 'A');
    expect(a?.ontologyVersionId).toBe(v3);
    expect(a?.version).toBe(atV1.version + 1);
    const durableTrail = await again.history.listByObject(a!.id);
    const durableMigration = durableTrail.find((e) => e.toOntologyVersionId === v3);
    expect(durableMigration?.fromOntologyVersionId).toBe(v1);
    expect((await again.objects.get(ontologyId, ITEM, 'B'))?.ontologyVersionId).toBe(v2);
  }
}
