/**
 * ontology-registry — tests/pg-registry.integration.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import { createPgOntologyRegistry } from '../src/core/pg-registry.js';
import { createIdGenerator, createDeterministicClock } from '../src/core/determinism.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('PgOntologyRegistry durability', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('create + commit survives restart', async () => {
    if (!db) return;
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const reg = createPgOntologyRegistry({ sql: db.sql, clock, nextId });
    const o = await reg.createOntology({ name: 'durable' });
    await reg.addPropertyType(o.id, { id: 'pt.n', displayName: 'N', baseType: 'string' });
    await reg.addObjectType(o.id, {
      id: 'ot.a',
      displayName: 'A',
      propertyTypeIds: ['pt.n'],
    });
    const v1 = await reg.commit({ ontologyId: o.id, createdBy: 'test' });

    await db.sql.close();
    const sql2 = db.reconnect();
    const reg2 = createPgOntologyRegistry({ sql: sql2 });
    const loaded = await reg2.getOntology(o.id);
    expect(loaded?.name).toBe('durable');
    const latest = await reg2.getLatestVersion(o.id);
    expect(latest?.id).toBe(v1.id);
    expect(latest?.contentHash).toBe(v1.contentHash);
    expect(latest?.objectTypes['ot.a']?.displayName).toBe('A');
    await sql2.close();
  });
});
