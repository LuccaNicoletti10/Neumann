/**
 * contracts — tests/sandbox.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenSandboxPolicy } from '../src/v1/sandbox.js';

describe('Sandbox contracts', () => {
  it('golden policy denies network by default', () => {
    expect(buildGoldenSandboxPolicy().allowNetwork).toBe(false);
  });
});
