/**
 * object-set — tests/coerce.test.ts
 */
import { describe, expect, it } from 'vitest';

import { NeumannApiError } from 'api-errors';

import {
  coerceFilter,
  coerceValue,
  evaluateFilter,
  propertyLookupFromTypes,
} from '../src/index.js';

const lookup = propertyLookupFromTypes({
  qty: 'number',
  status: 'string',
  active: 'boolean',
  due: 'datetime',
});

describe('coerce + typed evaluateFilter', () => {
  it('coerces HTTP string numbers', () => {
    expect(coerceValue('150', 'number')).toBe(150);
    expect(coerceValue('true', 'boolean')).toBe(true);
    expect(String(coerceValue('2024-01-15T00:00:00.000Z', 'datetime'))).toContain('2024-01-15');
  });

  it('unknown property is 400, not empty match', () => {
    expect(() =>
      coerceFilter({ type: 'EQUALS', property: 'custommerName', value: 'x' }, 'ot.item', lookup),
    ).toThrow(NeumannApiError);
    try {
      coerceFilter({ type: 'EQUALS', property: 'custommerName', value: 'x' }, 'ot.item', lookup);
    } catch (err) {
      expect((err as NeumannApiError).errorName).toBe('InvalidFilterValue');
      expect((err as NeumannApiError).statusCode).toBe(400);
    }
  });

  it('EQUALS number vs string "150" after coerce', () => {
    const filter = coerceFilter(
      { type: 'EQUALS', property: 'qty', value: '150' },
      'ot.item',
      lookup,
    );
    expect(
      evaluateFilter(
        {
          id: '1',
          ontologyId: 'o',
          objectTypeId: 'ot.item',
          primaryKey: 'a',
          properties: { qty: 150 },
          version: 1,
          deleted: false,
          createdAt: 't',
          updatedAt: 't',
        },
        filter,
        lookup,
      ),
    ).toBe(true);
  });

  it('strict GT against null is 400', () => {
    expect(() =>
      coerceFilter({ type: 'GT', property: 'qty', value: null }, 'ot.item', lookup),
    ).toThrow(NeumannApiError);
  });

  it('GT/LT compare numerically, not lexicographically', () => {
    const gt = coerceFilter({ type: 'GT', property: 'qty', value: '9' }, 'ot.item', lookup);
    const rec = {
      id: '1',
      ontologyId: 'o',
      objectTypeId: 'ot.item',
      primaryKey: 'a',
      properties: { qty: 10 },
      version: 1,
      deleted: false,
      createdAt: 't',
      updatedAt: 't',
    };
    expect(evaluateFilter(rec, gt, lookup)).toBe(true);
    const lt = coerceFilter({ type: 'LT', property: 'qty', value: '10' }, 'ot.item', lookup);
    expect(
      evaluateFilter({ ...rec, properties: { qty: 9 } }, lt, lookup),
    ).toBe(true);
  });
});
