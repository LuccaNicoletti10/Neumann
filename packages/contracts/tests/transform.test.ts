/**
 * contracts — tests/transform.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenTransformStep } from '../src/v1/transform.js';

describe('Transform contracts', () => {
  it('golden TransformStep é filter com values', () => {
    const step = buildGoldenTransformStep();
    expect(step.kind).toBe('filter');
    expect(step.params.column).toBe('status');
  });
});
