/**
 * contracts — tests/dataset-store.test.ts
 * Golden fixture do CommitInput (Passo 8).
 */
import { describe, expect, it } from 'vitest';

import {
  assertCommitInput,
  buildGoldenCommitInput,
} from '../src/v1/dataset-store.js';

describe('DatasetStore / CommitInput', () => {
  it('golden CommitInput inclui policyId e lineageRef (nullable)', () => {
    const input = buildGoldenCommitInput();
    assertCommitInput(input);
    expect(input.policyId).toBeNull();
    expect(input.lineageRef).toBeNull();
    expect(input.inputVersions).toEqual([]);
    expect(input.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('assertCommitInput rejeita ausência de campos reservados', () => {
    expect(() =>
      assertCommitInput({
        inputVersions: [],
        schemaVersion: '1',
        contentRef: 'x',
        contentHash: 'y',
      }),
    ).toThrow(/policyId/);
  });

  it('assertCommitInput rejeita inputVersions inválido', () => {
    expect(() =>
      assertCommitInput({
        inputVersions: 'nope',
        schemaVersion: '1',
        contentRef: 'x',
        contentHash: 'y',
        policyId: null,
        lineageRef: null,
      }),
    ).toThrow(/inputVersions/);
  });
});
