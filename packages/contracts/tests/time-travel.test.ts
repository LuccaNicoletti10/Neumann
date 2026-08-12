/**
 * contracts — tests/time-travel.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenSnapshotRequest } from '../src/v1/time-travel.js';

describe('TimeTravel contracts', () => {
  it('golden SnapshotRequest tem dataset + at ISO', () => {
    const req = buildGoldenSnapshotRequest();
    expect(req.dataset).toBe('accounts');
    expect(req.at).toBe('2024-01-01T14:37:22.000Z');
  });
});
