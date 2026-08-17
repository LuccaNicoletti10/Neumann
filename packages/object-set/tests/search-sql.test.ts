import { describe, expect, it } from 'vitest';

import { catalogHitUrn, compileCatalogSearch } from '../src/core/search-sql.js';

describe('catalog search SQL', () => {
  it('parameterizes q and never interpolates', () => {
    const sql = compileCatalogSearch({ q: "a'; drop", ontologyId: 'onto-1', limit: 10 });
    expect(sql.text).not.toContain("a'; drop");
    expect(sql.params).toContain("a'; drop");
    expect(sql.params).toContain('onto-1');
    expect(sql.text).toMatch(/\$1/);
  });

  it('catalogHitUrn is stable', () => {
    expect(
      catalogHitUrn({ ontology_id: 'o', object_type_id: 't', primary_key: '1' }),
    ).toBe('urn:neumann:o:t:1');
  });
});
