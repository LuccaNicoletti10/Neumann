/**
 * platform-api — tests/governed-storage-contract.test.ts
 * Memory arm of the shared governed-storage contract (PROMPT 09 cases 6–10).
 */
import { describe, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { runGovernedStorageContract } from './governed-storage-contract.js';

describe('governed-storage-contract — memory', () => {
  it('satisfies the shared contract', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all', deterministic: false });
    await runGovernedStorageContract({ ctx });
  });
});
