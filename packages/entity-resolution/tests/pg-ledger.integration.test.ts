/**
 * entity-resolution — tests/pg-ledger.integration.test.ts
 * Restart gate: audit + canonical + unmerge survive reconnect.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createEntityResolver } from '../src/core/engine.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('PgEntityLedger durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('commit + merge + unmerge survive restart', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const er = createEntityResolver({ sql: db.sql, clock, nextId });
    const result = er.runResolution({
      records: [
        {
          id: 'rec-A',
          objectTypeId: 'ot.customer',
          properties: { name: 'ACME LTDA', document: '12.345.678/0001-90' },
        },
        {
          id: 'rec-B',
          objectTypeId: 'ot.customer',
          properties: { name: 'Acme Ltda.', document: '12345678000190' },
        },
      ],
    });
    await er.commitRun(result);
    const canonical = await er.mergeCanonical({
      objectTypeId: 'ot.customer',
      memberIds: ['rec-A', 'rec-B'],
      principal: 'analyst.1',
      reason: 'document exact',
    });
    await er.unmerge({
      canonicalId: canonical.id,
      recordId: 'rec-B',
      principal: 'analyst.1',
      reason: 'false merge',
    });

    await db.sql.close();
    const sql2 = db.reconnect();
    const er2 = createEntityResolver({ sql: sql2 });
    const audit = await er2.listMatchAudit({ runId: result.runId });
    expect(audit.length).toBe(result.candidates.length);
    expect(audit[0]?.modelVersion).toBe(result.ruleVersionId);
    const loaded = await er2.getCanonical(canonical.id);
    expect(loaded?.memberIds).toEqual(['rec-A']);
    const linksB = await er2.linksForRecord('rec-B');
    expect(linksB.some((l) => l.status === 'unmerged')).toBe(true);
    const similar = await er2.searchSimilar({
      id: 'q1',
      objectTypeId: 'ot.customer',
      properties: { name: 'ACME LTDA', document: '12345678000190' },
    });
    expect(similar.some((s) => s.recordId === 'rec-A')).toBe(true);
  });
});
