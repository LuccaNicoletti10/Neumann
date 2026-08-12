/**
 * multi-row-transactions — tests/locks.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock } from '../src/core/determinism.js';
import { createLockService } from '../src/core/lease-lock.js';

describe('Lease locks', () => {
  it('WRITE bloqueia outro lessee; refresh/validate/release', () => {
    const clock = createDeterministicClock();
    const locks = createLockService({ clock, leaseMs: 60_000 });
    expect(locks.acquire('row:1', 'tx-a', 'WRITE')).toBe(true);
    expect(locks.acquire('row:1', 'tx-b', 'WRITE')).toBe(false);
    expect(locks.validate('row:1', 'tx-a')).toBe(true);
    expect(locks.refresh('row:1', 'tx-a')).toBe(true);
    expect(locks.release('row:1', 'tx-a')).toBe(true);
    expect(locks.acquire('row:1', 'tx-b', 'WRITE')).toBe(true);
  });
});
