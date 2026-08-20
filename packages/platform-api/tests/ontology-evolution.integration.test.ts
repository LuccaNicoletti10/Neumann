/**
 * platform-api — tests/ontology-evolution.integration.test.ts
 *
 * PROMPT 09 cases 11–22 over real PostgreSQL, including case 20 (restart keeps
 * ontologyVersionId and migration history) which memory cannot prove.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { VersionConflictError, tryOpenIsolatedPg } from 'object-platform';
import { createAllowAllTestPolicy } from 'policy-engine';

import { createPostgresPlatformContext } from '../src/core/context.js';
import { runOntologyEvolutionContract, seedEvolvingOntology } from './ontology-evolution.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('ontology evolution — PostgreSQL', () => {
  afterAll(async () => {
    await db?.close();
  });

  function open() {
    if (!db) throw new Error('no database');
    return createPostgresPlatformContext({
      sql: db.sql,
      transaction: db.sql,
      policy: createAllowAllTestPolicy(),
    });
  }

  it('pins, migrates and survives restart', async () => {
    if (!db) return;
    const ctx = await open();
    const opened: Awaited<ReturnType<typeof open>>[] = [];
    try {
      await runOntologyEvolutionContract({
        ctx,
        reopen: async () => {
          const next = await open();
          opened.push(next);
          return next;
        },
      });
    } finally {
      for (const c of opened) await c.close?.();
      await ctx.close?.();
    }
  });

  it('case 17: two real transactions migrating one object leave one winner', async () => {
    if (!db) return;
    // WHY separate from the shared suite: two independent PlatformContexts over
    // the same schema is a real database race, not a promise interleaving.
    const seeder = await open();
    const a = await open();
    const b = await open();
    try {
      const { ontologyId, v1 } = await seedEvolvingOntology(seeder);
      await seeder.projections.projectObject({
        ontologyId,
        objectTypeId: 'ot.item',
        primaryKey: 'RACE',
        properties: { n: 'r', qty: 1 },
        source: 'erp',
        sourceEventId: 'evt-race-seed',
        principal: 'svc',
      });
      const draft = await seeder.ontology.openDraft(ontologyId);
      expect(draft.baseVersionId).toBe(v1);
      await seeder.ontology.addPropertyType(ontologyId, {
        id: 'note',
        displayName: 'note',
        baseType: 'string',
      });
      (await seeder.ontology.getDraft(ontologyId))!.objectTypes['ot.item']!.propertyTypeIds.push(
        'note',
      );
      const v2 = (await seeder.ontology.commit({ ontologyId, createdBy: 'test' })).id;

      const seeded = (await seeder.objects.get(ontologyId, 'ot.item', 'RACE'))!;
      const migrate = (ctx: Awaited<ReturnType<typeof open>>, key: string) =>
        ctx.projections.migrateObject({
          ontologyId,
          objectTypeId: 'ot.item',
          primaryKey: 'RACE',
          fromVersionId: v1,
          toVersionId: v2,
          expectedObjectVersion: seeded.version,
          transformedProperties: { n: 'r', qty: 1 },
          principal: 'admin',
          idempotencyKey: key,
        });

      const outcomes = await Promise.allSettled([
        migrate(a, 'race-a'),
        migrate(b, 'race-b'),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(VersionConflictError);

      const after = (await seeder.objects.get(ontologyId, 'ot.item', 'RACE'))!;
      expect(after.version).toBe(seeded.version + 1);
      expect(after.ontologyVersionId).toBe(v2);
    } finally {
      await b.close?.();
      await a.close?.();
      await seeder.close?.();
    }
  });
});
