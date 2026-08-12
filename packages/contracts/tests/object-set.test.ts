/**
 * contracts — tests/object-set.test.ts
 */
import { describe, expect, it } from 'vitest';

import type { ObjectSet } from '../src/v1/object-set.js';

describe('contracts — object-set', () => {
  it('compose BASE + FILTER + SEARCH_AROUND', () => {
    const set: ObjectSet = {
      type: 'SEARCH_AROUND',
      link: 'lt.customer-orders',
      objectSet: {
        type: 'FILTER',
        filter: { type: 'EQUALS', property: 'pt.status', value: 'active' },
        objectSet: { type: 'BASE', objectType: 'ot.customer' },
      },
    };
    expect(set.type).toBe('SEARCH_AROUND');
  });
});
