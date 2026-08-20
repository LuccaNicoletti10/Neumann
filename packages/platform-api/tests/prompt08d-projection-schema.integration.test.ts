/**
 * platform-api — tests/prompt08d-projection-schema.integration.test.ts
 *
 * PostgreSQL proofs: object schema on a pinned OntologyVersion during projectBatch.
 * Invalid cases leave projection_ledger, objects/links, history, events, audit, outbox unchanged.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';
import { createAllowAllTestPolicy } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';

const db = await tryOpenIsolatedPg();

type Sql = NonNullable<Awaited<ReturnType<typeof tryOpenIsolatedPg>>>['sql'];

async function counts(sql: Sql, ontologyId: string) {
  const q = async (text: string, params: unknown[] = []) => {
    const r = await sql.query(text, params);
    return Number((r.rows[0] as { n: number }).n);
  };
  return {
    ledger: await q(`SELECT count(*)::int AS n FROM projection_ledger WHERE ontology_id = $1`, [
      ontologyId,
    ]),
    objects: await q(`SELECT count(*)::int AS n FROM platform_objects WHERE ontology_id = $1`, [
      ontologyId,
    ]),
    links: await q(`SELECT count(*)::int AS n FROM platform_links WHERE ontology_id = $1`, [
      ontologyId,
    ]),
    history: await q(
      `SELECT count(*)::int AS n FROM platform_object_history WHERE ontology_id = $1`,
      [ontologyId],
    ),
    events: await q(
      `SELECT count(*)::int AS n FROM platform_operational_events WHERE ontology_id = $1`,
      [ontologyId],
    ),
    audit: await q(`SELECT count(*)::int AS n FROM platform_audit_entries`),
    outbox: await q(`SELECT count(*)::int AS n FROM outbox_events`),
  };
}

async function seedOntology(sql: Sql, name: string) {
  const ctx = await createPostgresPlatformContext({
    sql,
    transaction: sql,
    policy: createAllowAllTestPolicy(),
  });
  const o = await ctx.ontology.createOntology({ name });
  await ctx.ontology.addPropertyType(o.id, {
    id: 'name',
    displayName: 'Name',
    baseType: 'string',
    validators: [{ kind: 'required' }],
  });
  await ctx.ontology.addPropertyType(o.id, { id: 'qty', displayName: 'Qty', baseType: 'number' });
  await ctx.ontology.addPropertyType(o.id, { id: 'note', displayName: 'Note', baseType: 'string' });
  await ctx.ontology.addObjectType(o.id, {
    id: 'ot.item',
    displayName: 'Item',
    propertyTypeIds: ['name', 'qty', 'note'],
  });
  await ctx.ontology.commit({ ontologyId: o.id, createdBy: 'test' });
  return { ctx, ontologyId: o.id };
}

function batch(
  ontologyId: string,
  sourceEventId: string,
  properties: Record<string, unknown>,
) {
  return {
    ontologyId,
    source: 'erp',
    sourceEventId,
    principal: 'svc',
    effects: [
      {
        kind: 'project_object' as const,
        cmd: {
          ontologyId,
          objectTypeId: 'ot.item',
          primaryKey: 'seed-ok',
          properties: { name: 'ok', qty: 1 },
          source: 'erp',
          sourceEventId,
          principal: 'svc',
        },
      },
      {
        kind: 'project_object' as const,
        cmd: {
          ontologyId,
          objectTypeId: 'ot.item',
          primaryKey: 'bad',
          properties,
          source: 'erp',
          sourceEventId,
          principal: 'svc',
        },
      },
    ],
  };
}

describe.skipIf(!db)('Prompt 08D — object schema in projection batch (PostgreSQL)', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('required ausente → zero ledger/objects/links/history/events/audit/outbox', async () => {
    if (!db) return;
    const { ctx, ontologyId } = await seedOntology(db.sql, 'pg-schema-required');
    const before = await counts(db.sql, ontologyId);
    await expect(ctx.projections.projectBatch(batch(ontologyId, 'req-missing', { qty: 1 }))).rejects.toThrow(
      /ontology validation failed|required/,
    );
    expect(await counts(db.sql, ontologyId)).toEqual(before);
    await ctx.close?.();
  });

  it('baseType incorreto → zero side effects', async () => {
    if (!db) return;
    const { ctx, ontologyId } = await seedOntology(db.sql, 'pg-schema-basetype');
    const before = await counts(db.sql, ontologyId);
    await expect(
      ctx.projections.projectBatch(batch(ontologyId, 'bad-type', { name: 'n', qty: 'nope' })),
    ).rejects.toThrow(/ontology validation failed|expected number/);
    expect(await counts(db.sql, ontologyId)).toEqual(before);
    await ctx.close?.();
  });

  it('null quando nullable=false → zero side effects', async () => {
    if (!db) return;
    const { ctx, ontologyId } = await seedOntology(db.sql, 'pg-schema-null-false');
    const before = await counts(db.sql, ontologyId);
    await expect(
      ctx.projections.projectBatch(batch(ontologyId, 'null-req', { name: null, qty: 1 })),
    ).rejects.toThrow(/ontology validation failed|not nullable|required/);
    expect(await counts(db.sql, ontologyId)).toEqual(before);
    await ctx.close?.();
  });

  it('null permitido quando nullable=true', async () => {
    if (!db) return;
    const { ctx, ontologyId } = await seedOntology(db.sql, 'pg-schema-null-true');
    const result = await ctx.projections.projectBatch({
      ontologyId,
      source: 'erp',
      sourceEventId: 'null-ok',
      principal: 'svc',
      effects: [
        {
          kind: 'project_object',
          cmd: {
            ontologyId,
            objectTypeId: 'ot.item',
            primaryKey: 'n1',
            properties: { name: 'n', qty: 1, note: null },
            source: 'erp',
            sourceEventId: 'null-ok',
            principal: 'svc',
          },
        },
      ],
    });
    expect(result.status).toBe('applied');
    const obj = await ctx.objects.get(ontologyId, 'ot.item', 'n1');
    expect(obj?.properties.note).toBeNull();
    await ctx.close?.();
  });

  it('propriedade desconhecida → zero side effects', async () => {
    if (!db) return;
    const { ctx, ontologyId } = await seedOntology(db.sql, 'pg-schema-unknown');
    const before = await counts(db.sql, ontologyId);
    await expect(
      ctx.projections.projectBatch(
        batch(ontologyId, 'unknown-prop', { name: 'n', qty: 1, extra: true }),
      ),
    ).rejects.toThrow(/ontology validation failed|not declared/);
    expect(await counts(db.sql, ontologyId)).toEqual(before);
    await ctx.close?.();
  });
});
