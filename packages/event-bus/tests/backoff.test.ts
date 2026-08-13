import { describe, expect, it } from 'vitest';

import { computeBackoffMs, DEFAULT_BACKOFF_MS } from '../src/worker/backoff.js';

describe('outbox backoff', () => {
  it('uses schedule with jitter in [0.8, 1.2]', () => {
    expect(computeBackoffMs(1, { random: () => 0.5 })).toBe(DEFAULT_BACKOFF_MS[0]);
    expect(computeBackoffMs(2, { random: () => 0.5 })).toBe(DEFAULT_BACKOFF_MS[1]);
    expect(computeBackoffMs(6, { random: () => 0.5 })).toBe(DEFAULT_BACKOFF_MS[5]);
    expect(computeBackoffMs(99, { random: () => 0.5 })).toBe(DEFAULT_BACKOFF_MS[5]);
    const low = computeBackoffMs(1, { random: () => 0 });
    const high = computeBackoffMs(1, { random: () => 1 });
    expect(low).toBe(Math.round(DEFAULT_BACKOFF_MS[0]! * 0.8));
    expect(high).toBe(Math.round(DEFAULT_BACKOFF_MS[0]! * 1.2));
  });
});
