/**
 * object-set — catalog search PG: structural GIN plan, not wall-clock.
 *
 * The former <100ms bound matched any "Index Scan" (including the ontology
 * btree) and then timed the query. Load made that flaky. Correctness is:
 * a live GIN index exists, EXPLAIN JSON names it for the search predicates,
 * and the compiled search returns the addressed row.
 *
 * OR of ILIKE (no trigram) with tsvector @@ forces a seq scan. UNION lets
 * the FTS arm use platform_objects_props_fts. ontology_id is a competing
 * btree prefix and is still used for result correctness.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tryOpenIsolatedPg } from 'object-platform';

import {
  CATALOG_RELATION,
  explainCatalogQuery,
  inspectCatalogPlan,
  inspectExplainedCatalogQuery,
  listRelationIndexes,
} from '../src/core/catalog-plan.js';
import { compileCatalogSearch } from '../src/core/search-sql.js';

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('catalog search PG', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('EXPLAIN uses a live GIN index; search returns the addressed row', async () => {
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
         jsonb_build_object(
           'note', 'hello-' || g,
           'token', CASE WHEN g = 42 THEN 'zxqv42unique' ELSE 'other-' || g END
         ),
         1, false, now(), now()
       FROM generate_series(1, 10000) AS g`,
    );
    await db.sql.query(`ANALYZE platform_objects`);

    const indexes = await listRelationIndexes(db.sql, CATALOG_RELATION);
    const ginNames = indexes.filter((idx) => idx.accessMethod === 'gin').map((idx) => idx.name);
    expect(ginNames).toContain('platform_objects_props_fts');

    const compiled = compileCatalogSearch({
      q: 'zxqv42unique',
      ontologyId: 'onto-cat',
      limit: 10,
    });
    const ginVerdict = await inspectExplainedCatalogQuery(db.sql, compiled, indexes);
    if (!ginVerdict.usedGin) {
      const raw = await explainCatalogQuery(db.sql, compiled);
      throw new Error(
        `catalog search did not use GIN: ${JSON.stringify({ indexes, ginVerdict, inspection: inspectCatalogPlan(raw), raw }, null, 2)}`,
      );
    }
    expect(ginVerdict.ginIndexesUsed).toContain('platform_objects_props_fts');

    const hits = await db.sql.query<{ primary_key: string }>(compiled.text, compiled.params);
    expect(hits.rows.length).toBeGreaterThanOrEqual(1);
    expect(hits.rows[0]?.primary_key).toContain('000042');

    const byId = {
      text: `SELECT id, primary_key FROM platform_objects WHERE id = $1`,
      params: ['cat-42'],
    };
    const btreeVerdict = await inspectExplainedCatalogQuery(db.sql, byId, indexes);
    expect(btreeVerdict.usedGin).toBe(false);
    expect(btreeVerdict.otherIndexesUsed).toContain('platform_objects_pkey');
  }, 30_000);
});
