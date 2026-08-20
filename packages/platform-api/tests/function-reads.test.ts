/**
 * platform-api — Function reads use history.asOf only (ADR-0020).
 */
import { describe, expect, it } from 'vitest';

import { FunctionSnapshotUnavailableError } from 'function-registry';
import { ALLOW_ALL_POLICY_OVERLAY, type PolicyOverlay } from 'policy-engine';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { createFunctionObjectReader } from '../src/core/function-reads.js';

const baseGrant = ALLOW_ALL_POLICY_OVERLAY.grants[0];
if (!baseGrant) throw new Error('ALLOW_ALL overlay missing grant');
const redacting: PolicyOverlay = {
  everyoneRole: 'world',
  roles: {},
  grants: [{ ...baseGrant, hiddenProperties: ['secret'] }],
};

async function seedRecordOntology(
  ctx: ReturnType<typeof createMemoryPlatformContext>,
): Promise<string> {
  const o = await ctx.ontology.createOntology({ name: 'fn-asof' });
  await ctx.ontology.addPropertyType(o.id, { id: 'n', displayName: 'N', baseType: 'number' });
  await ctx.ontology.addPropertyType(o.id, {
    id: 'secret',
    displayName: 'Secret',
    baseType: 'string',
  });
  await ctx.ontology.addObjectType(o.id, {
    id: 'ot.record',
    displayName: 'Record',
    propertyTypeIds: ['n', 'secret'],
  });
  await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  return o.id;
}

describe('createFunctionObjectReader', () => {
  it('returns the historical snapshot and ignores later versions', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedRecordOntology(ctx);
    const reads = createFunctionObjectReader(ctx.policy, ctx.history);
    await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1, secret: 'hide' },
    });
    const rec = (await ctx.objects.get(ontologyId, 'ot.record', 'A'))!;
    const snap = (await ctx.history.listByObject(rec.id))[0]!;
    await ctx.objects.update(ontologyId, 'ot.record', 'A', {
      properties: { n: 2 },
      expectedVersion: 1,
    });
    const got = await reads.getObject(
      'alice',
      ontologyId,
      'ot.record',
      'A',
      snap.createdAt,
      snap.seq,
    );
    expect(got?.properties.n).toBe(1);
  });

  it('applies current redaction on the historical properties', async () => {
    const ctx = createMemoryPlatformContext({ overlay: redacting });
    const ontologyId = await seedRecordOntology(ctx);
    const reads = createFunctionObjectReader(ctx.policy, ctx.history);
    await ctx.objects.create({
      ontologyId,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1, secret: 'nope' },
    });
    const rec = (await ctx.objects.get(ontologyId, 'ot.record', 'A'))!;
    const snap = (await ctx.history.listByObject(rec.id))[0]!;
    const got = await reads.getObject(
      'alice',
      ontologyId,
      'ot.record',
      'A',
      snap.createdAt,
      snap.seq,
    );
    expect(got?.properties).toEqual({ n: 1 });
    expect(got?.properties).not.toHaveProperty('secret');
  });

  it('hidden object type is undefined; missing or deleted snapshot throws', async () => {
    const allow = createMemoryPlatformContext({ policyFixture: 'allow-all' });
    const ontologyId = await seedRecordOntology(allow);
    const deny = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    const hidden = createFunctionObjectReader(deny.policy, allow.history);
    const emptyMark = await allow.history.watermark();
    expect(
      await hidden.getObject(
        'eve',
        ontologyId,
        'ot.record',
        'A',
        emptyMark.recordedAt,
        emptyMark.seq,
      ),
    ).toBe(undefined);

    const reads = createFunctionObjectReader(allow.policy, allow.history);
    await expect(
      reads.getObject(
        'alice',
        ontologyId,
        'ot.record',
        'A',
        emptyMark.recordedAt,
        emptyMark.seq,
      ),
    ).rejects.toBeInstanceOf(FunctionSnapshotUnavailableError);

    await allow.objects.create({
      ontologyId,
      objectTypeId: 'ot.record',
      primaryKey: 'A',
      properties: { n: 1, secret: 'x' },
    });
    const rec = (await allow.objects.get(ontologyId, 'ot.record', 'A'))!;
    await allow.objects.delete(ontologyId, 'ot.record', 'A', { expectedVersion: 1 });
    const afterDelete = (await allow.history.listByObject(rec.id)).at(-1)!;
    await expect(
      reads.getObject(
        'alice',
        ontologyId,
        'ot.record',
        'A',
        afterDelete.createdAt,
        afterDelete.seq,
      ),
    ).rejects.toBeInstanceOf(FunctionSnapshotUnavailableError);
  });
});
