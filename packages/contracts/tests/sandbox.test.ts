/**
 * contracts — tests/sandbox.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenSandboxPolicy, type SandboxDenyReason } from '../src/v1/sandbox.js';

describe('Sandbox contracts', () => {
  it('golden policy denies network by default', () => {
    expect(buildGoldenSandboxPolicy().allowNetwork).toBe(false);
  });

  it('EXECUTION_ERROR is a terminal reason distinct from FORBIDDEN_API', () => {
    const reasons: SandboxDenyReason[] = [
      'TIMEOUT',
      'MEMORY_LIMIT',
      'FS_ESCAPE',
      'NETWORK_DENIED',
      'IDENTITY_REQUIRED',
      'FORBIDDEN_API',
      'OUTPUT_TOO_LARGE',
      'EXECUTION_ERROR',
    ];
    expect(new Set(reasons).size).toBe(8);
    expect(reasons).toContain('EXECUTION_ERROR');
    expect(reasons).not.toContain('CANCELLED');
  });
});
