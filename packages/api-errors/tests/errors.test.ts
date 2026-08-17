/**
 * api-errors — tests/errors.test.ts
 */
import { describe, expect, it } from 'vitest';

import { hiddenMiss, NeumannApiError, versionConflict } from '../src/index.js';

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

  it('hiddenMiss is 404 NOT_FOUND with canonical message', () => {
    const err = hiddenMiss();
    expect(err.statusCode).toBe(404);
    expect(err.errorCode).toBe('NOT_FOUND');
    expect(err.errorName).toBe('ResourceNotFound');
    expect(err.message).toBe('not found');
  });
});
