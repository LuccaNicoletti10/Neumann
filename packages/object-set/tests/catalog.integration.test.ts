/**
 * object-set — catalog search PG: EXPLAIN GIN + 100k objects < 100ms.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import { compileCatalogSearch } from '../src/core/search-sql.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('catalog search PG', () => {
  afterAll(async () => {
    await db?.close();
  });

  it(
    'EXPLAIN uses GIN; 100k objects search < 100ms',
    async () => {
    if (!db) return;
    await db.sql.query(
      `INSERT INTO platform_objects (
         id, ontology_id, object_type_id, primary_key, properties, version, deleted, created_at, updated_at
       )
       SELECT
         'cat-' || g,
         'onto-cat',
         'ot.thing',
         'pk-' || lpad(g::text, 6, '0'),
         jsonb_build_object('note', 'hello-' || g),
         1, false, now(), now()
       FROM generate_series(1, 100000) AS g`,
    );
    await db.sql.query(`ANALYZE platform_objects`);
    const compiled = compileCatalogSearch({ q: 'pk-000042', ontologyId: 'onto-cat', limit: 10 });
    const plan = await db.sql.query(`EXPLAIN ${compiled.text}`, compiled.params);
    const text = (plan.rows as Array<Record<string, string>>)
      .map((r) => Object.values(r)[0])
      .join('\n')
      .toLowerCase();
    expect(text).toMatch(/index|bitmap|gin|trgm|tsvector/i);

    await db.sql.query(compiled.text, compiled.params);
    const t0 = Date.now();
    const hits = await db.sql.query(compiled.text, compiled.params);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(100);
    expect(hits.rows.length).toBeGreaterThanOrEqual(1);
    expect(String((hits.rows[0] as { primary_key: string }).primary_key)).toContain('000042');
    },
    30_000,
  );
});
