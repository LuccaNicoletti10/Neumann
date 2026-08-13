/**
 * object-set — tests/compile-sql.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  compileFilter,
  compileObjectSet,
  createCompileCtx,
  propertyLookupFromTypes,
} from '../src/index.js';

const lookup = propertyLookupFromTypes({
  status: 'string',
  qty: 'number',
  sku: 'string',
});

describe('compile-sql', () => {
  it('parameterizes every value ($n) and never interpolates', () => {
    const ctx = createCompileCtx('onto-1', lookup);
    const sql = compileObjectSet(
      {
        type: 'FILTER',
        filter: { type: 'EQUALS', property: 'status', value: 'open' },
        objectSet: { type: 'BASE', objectType: 'ot.item' },
      },
      ctx,
    );
    expect(sql.text).not.toContain("'open'");
    expect(sql.text).not.toContain("'ot.item'");
    expect(sql.params).toContain('onto-1');
    expect(sql.params).toContain('ot.item');
    expect(sql.params).toContain('status');
    expect(sql.params).toContain('open');
    expect(sql.text).toMatch(/\$1/);
  });

  it('string EQUALS uses jsonb @> fast path', () => {
    const ctx = createCompileCtx('o', lookup);
    const where = compileFilter({ type: 'EQUALS', property: 'status', value: 'open' }, 'ot.item', ctx);
    expect(where).toContain('@>');
    expect(where).toContain('jsonb_build_object');
  });

  it('number EQUALS / GT use numeric cast', () => {
    const ctx = createCompileCtx('o', lookup);
    const eq = compileFilter({ type: 'EQUALS', property: 'qty', value: 150 }, 'ot.item', ctx);
    expect(eq).toContain('::numeric');
    expect(eq).not.toContain('@>');
    const gt = compileFilter({ type: 'GT', property: 'qty', value: 9 }, 'ot.item', ctx);
    expect(gt).toContain('::numeric');
    expect(gt).toContain('>');
  });

  it('NOT_EQUALS uses IS DISTINCT FROM', () => {
    const ctx = createCompileCtx('o', lookup);
    const sql = compileFilter({ type: 'NOT_EQUALS', property: 'qty', value: 1 }, 'ot.item', ctx);
    expect(sql).toContain('IS DISTINCT FROM');
  });

  it('LIKE escapes user wildcards', () => {
    const ctx = createCompileCtx('o', lookup);
    compileFilter({ type: 'CONTAINS', property: 'sku', value: 'NIT_10%' }, 'ot.item', ctx);
    expect(ctx.params).toContain('NIT\\_10\\%');
  });

  it('SEARCH_AROUND is a single join query', () => {
    const ctx = createCompileCtx('o', lookup);
    const sql = compileObjectSet(
      {
        type: 'SEARCH_AROUND',
        link: 'lt.hub-item',
        objectSet: { type: 'STATIC', objectType: 'ot.hub', primaryKeys: ['h1'] },
      },
      ctx,
    );
    expect(sql.text).toMatch(/JOIN platform_links/i);
    expect(sql.text).toMatch(/JOIN platform_objects t/i);
    expect(sql.params).toContain('lt.hub-item');
  });

  it('UNION / INTERSECT / EXCEPT compile set ops', () => {
    const ctx = createCompileCtx('o', lookup);
    const sql = compileObjectSet(
      {
        type: 'SUBTRACT',
        objectSets: [
          { type: 'BASE', objectType: 'ot.item' },
          { type: 'STATIC', objectType: 'ot.item', primaryKeys: ['c'] },
        ],
      },
      ctx,
    );
    expect(sql.text).toMatch(/EXCEPT/i);
  });
});
