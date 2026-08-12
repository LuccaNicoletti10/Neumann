/**
 * contracts — tests/data-quality.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenQualityRule } from '../src/v1/data-quality.js';

describe('Data quality contracts', () => {
  it('golden rule has quarantine action', () => {
    const r = buildGoldenQualityRule();
    expect(r.action.kind).toBe('quarantine');
    expect(r.condition.kind).toBe('not_null');
  });
});
