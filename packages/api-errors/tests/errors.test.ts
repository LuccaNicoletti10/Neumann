/**
 * api-errors — tests/errors.test.ts
 */
import { describe, expect, it } from 'vitest';

import { NeumannApiError, versionConflict } from '../src/index.js';

describe('api-errors', () => {
  it('serializes VERSION_CONFLICT as 409', () => {
    const err = versionConflict({ expectedVersion: 5 });
    expect(err.statusCode).toBe(409);
    expect(err.toJSON().errorCode).toBe('VERSION_CONFLICT');
  });

  it('assigns errorInstanceId', () => {
    const err = new NeumannApiError({
      errorCode: 'NOT_FOUND',
      errorName: 'X',
      message: 'missing',
    });
    expect(err.errorInstanceId.length).toBeGreaterThan(8);
  });
});
